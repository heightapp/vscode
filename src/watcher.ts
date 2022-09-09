import updateTodos, {parseGitIgnore} from '@heightapp/update-todos';
import createClient from 'clientHelpers/createClient';
import getDefaultListIds from 'clientHelpers/getDefaultListIds';
import zipObject from 'lodash/zipObject';
import {AuthenticationSession, Disposable, EventEmitter, ExtensionContext, extensions, workspace} from 'vscode';

import path from 'path';

class Watcher {
  readonly session: AuthenticationSession;
  private context: ExtensionContext;

  private eventEmitter = new EventEmitter<{type: 'error'; error: unknown}>();
  private gitRepoRoots: Array<string>;
  private onDidSaveTextDocumentDisposable?: Disposable;

  constructor(session: AuthenticationSession, context: ExtensionContext) {
    this.session = session;
    this.context = context;

    const gitExtension = extensions.getExtension('vscode.git')?.exports?.getAPI(1);
    this.gitRepoRoots = gitExtension?.repositories?.map((repo: any) => repo?.repository?.root) ?? [];
  }

  get onWatchError() {
    return this.eventEmitter.event;
  }

  watch = async () => {
    // Get necessary data to create tasks
    const refreshToken = this.session.accessToken;
    const userId = this.session.account.id;
    const client = createClient(refreshToken, this.context);
    const listIds = await getDefaultListIds(client);

    // Parse gitignores
    const gitIgnores = await Promise.all(this.gitRepoRoots.map(parseGitIgnore));
    const gitIgnoresByRepoRoots = zipObject(this.gitRepoRoots, gitIgnores);

    // List to document saves
    this.onDidSaveTextDocumentDisposable = workspace.onDidSaveTextDocument((document) => {
      const repoPath = this.gitRepoRoots.find((root) => document.fileName.startsWith(root));
      if (repoPath) {
        const gitIgnore = gitIgnoresByRepoRoots[repoPath];
        const relativePath = path.relative(repoPath, document.fileName);
        if (gitIgnore && !gitIgnore.accepts(relativePath)) {
          // File is ignored
          return;
        }
      }

      updateTodos({
        filePath: document.fileName,
        repoPath,
        onCreateTask: async (name) => {
          try {
            return await client.task.create({name, listIds, assigneesIds: [userId]});
          } catch (e) {
            this.eventEmitter.fire({type: 'error', error: e});
            return null;
          }
        },
      });
    });
  };

  dispose() {
    this.eventEmitter.dispose();
    this.onDidSaveTextDocumentDisposable?.dispose();
  }
}

export default Watcher;
