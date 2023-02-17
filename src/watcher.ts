import updateTodos, {parseGitIgnore} from '@heightapp/update-todos';
import createClient from 'clientHelpers/createClient';
import getDefaultListIds from 'clientHelpers/getDefaultListIds';
import memoize from 'memoizee';
import createThrottleQueue from 'throttled-queue';
import {AuthenticationSession, Disposable, EventEmitter, ExtensionContext, extensions, FileType, TextDocument, Uri, workspace} from 'vscode';

import path from 'path';

const MAX_TASKS_PER_MINUTE = 20;
const MAX_FOLDER_DEPTH = 30;

class Watcher {
  readonly session: AuthenticationSession;
  private context: ExtensionContext;

  private eventEmitter = new EventEmitter<{type: 'error'; error: unknown}>();
  private gitRepoRoots: Set<string>;
  private onDidSaveTextDocumentDisposable?: Disposable;
  private throttle = createThrottleQueue(MAX_TASKS_PER_MINUTE, 60000);

  constructor(session: AuthenticationSession, context: ExtensionContext) {
    this.session = session;
    this.context = context;

    const gitExtension = extensions.getExtension('vscode.git')?.exports?.getAPI(1);
    this.gitRepoRoots = new Set(gitExtension?.repositories?.map((repo: any) => repo?.repository?.root) ?? []);
  }

  private memoizedIsRepoRoot = memoize(
    async (uri: Uri) => {
      if (this.gitRepoRoots.has(uri.fsPath)) {
        // Found in git extension
        return true;
      }

      // Check if .git exists in directory
      try {
        const stats = await workspace.fs.stat(Uri.joinPath(uri, '.git'));
        return stats.type === FileType.Directory;
      } catch (e) {
        return false;
      }
    },
    {
      max: 1000,
      maxAge: 1000 * 60 * 60, // 1 hour
      normalizer: ([uri]: [Uri]) => uri.fsPath,
    },
  );

  private memoizedGitIgnore = memoize(
    async (uri) => {
      return parseGitIgnore(uri.fsPath);
    },
    {
      max: 100,
      maxAge: 1000 * 60 * 60 * 24, // 24 hour
      normalizer: ([uri]: [Uri]) => uri.fsPath,
    },
  );

  private findGitRepoUri = async (document: TextDocument): Promise<Uri | null> => {
    // Try to find git repo by going up the folder tree
    // Max X folders up to make sure there's no infinite loop
    let depth = 0;
    let folderUri = document.uri;
    do {
      depth++;
      folderUri = Uri.file(path.dirname(folderUri.fsPath));
      const isRepoRoot = await this.memoizedIsRepoRoot(folderUri);
      if (isRepoRoot) {
        return folderUri;
      }
    } while (folderUri.fsPath !== path.sep && depth < MAX_FOLDER_DEPTH);

    if (depth >= MAX_FOLDER_DEPTH) {
      // Fallback on gitRepoRoots
      const gitRepoRoot = Array.from(this.gitRepoRoots).find((root) => document.uri.fsPath.startsWith(root));
      return gitRepoRoot ? Uri.file(gitRepoRoot) : null;
    }

    return null;
  };

  get onWatchError() {
    return this.eventEmitter.event;
  }

  watch = async () => {
    // Get necessary data to create tasks
    const refreshToken = this.session.accessToken;
    const userId = this.session.account.id;
    const client = createClient(refreshToken, this.context);
    const listIds = await getDefaultListIds(client);

    // List to document saves
    this.onDidSaveTextDocumentDisposable = workspace.onDidSaveTextDocument(async (document) => {
      const repoUri = await this.findGitRepoUri(document);
      if (repoUri) {
        const gitIgnore = await this.memoizedGitIgnore(repoUri);
        const relativePath = path.relative(repoUri.fsPath, document.uri.fsPath);
        if (gitIgnore && !gitIgnore.accepts(relativePath)) {
          // File is ignored
          return;
        }
      }

      updateTodos({
        filePath: document.uri.fsPath,
        repoPath: repoUri?.fsPath,
        onCreateTask: async (name) => {
          try {
            return await this.throttle(() => {
              return client.task.create({name, listIds, assigneesIds: [userId]});
            });
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
