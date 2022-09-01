import Client from '@heightapp/client';
import AuthProvider from 'authProvider';
import createClient, {AUTH_SCOPES} from 'clientHelpers/createClient';
import appEnv from 'env';
import {packagePublisher} from 'helpers/package';
import switchImpossibleCase from 'helpers/switchImpossibleCase';
import {authentication, commands, ExtensionContext, window} from 'vscode';
import Watcher from 'watcher';

// Setup client for development
if (appEnv.nodeEnv === 'development') {
  Client.setupHostsForDev({
    apiHost: appEnv.apiHost,
    webHost: appEnv.webHost,
  });
}

let watcherPromise: Thenable<Watcher> | undefined;

const logout = async (authProvider: AuthProvider, context: ExtensionContext) => {
  const sessions = await authProvider.getSessions();
  if (!sessions.length) {
    return;
  }

  await Promise.all(
    sessions.map((session) => {
      const refreshToken = session.accessToken; // Access token is actually refresh token
      const client = createClient(refreshToken, context);
      return Promise.all([client.auth.revoke(refreshToken), authProvider.removeSession(session.id)]);
      return authProvider.removeSession(session.id);
    }),
  );
};

const startWatch = async (authProvider: AuthProvider, context: ExtensionContext) => {
  // Cleanup old watcher
  if (watcherPromise) {
    (await watcherPromise).dispose();
  }

  // Get sessions or request authentication
  watcherPromise = authentication.getSession(packagePublisher(context), AUTH_SCOPES).then(async (existingSession) => {
    if (existingSession) {
      // Already authenticated, start watch
      return new Watcher(existingSession, context);
    }

    // Not authenticated yet. Request authentication and start watch
    return authentication.getSession(packagePublisher(context), AUTH_SCOPES, {createIfNone: true}).then((session) => {
      window.showInformationMessage(`You're signed in to Height as ${session.account.label}`);
      return new Watcher(session, context);
    });
  });

  // Start watching
  watcherPromise.then(
    (watcher) => {
      watcher.onWatchError(async (event) => {
        switch (event.type) {
          case 'invalidToken': {
            // Show message
            window.showErrorMessage('Your session has expired. Please sign in again.');

            // Log out
            await logout(authProvider, context);

            // Restart watch
            startWatch(authProvider, context);
            break;
          }
          default: {
            switchImpossibleCase(event.type);
          }
        }
      });

      watcher.watch();
    },
    (e) => {
      if (e instanceof Error && e.message.includes('User did not consent to login')) {
        window.showErrorMessage('Height is not correctly configured', {
          modal: true,
          detail: 'Since you have denied access to your account, the extension will not work. In order to retrying signin in, please restart VSCode.',
        });
      } else {
        window.showErrorMessage(e.message ?? 'An unknown error occurred while trying to sign in to Height.', {
          modal: true,
        });
      }
    },
  );
};

export function activate(context: ExtensionContext) {
  // Register auth provider
  const authProvider = new AuthProvider(context);
  context.subscriptions.push(authProvider);

  // Bind login/logout commands
  context.subscriptions.push(
    commands.registerCommand('height-vscode.login', async () => {
      (await watcherPromise)?.dispose();
      await logout(authProvider, context);
      startWatch(authProvider, context);
    }),
  );

  context.subscriptions.push(
    commands.registerCommand('height-vscode.logout', async () => {
      (await watcherPromise)?.dispose();
      await logout(authProvider, context);
      window.showInformationMessage("You're logged out of Height");
    }),
  );

  // Start watch
  startWatch(authProvider, context);
}

export async function deactivate() {
  (await watcherPromise)?.dispose();
}
