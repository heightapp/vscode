import Client, {ClientError, ClientErrorCode} from '@heightapp/client';
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

let watcher: Watcher | undefined;

const messageFromError = (error: unknown) => {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unknown error occurred.';
};

const login = async (authProvider: AuthProvider, context: ExtensionContext) => {
  try {
    const existingSession = await authentication.getSession(packagePublisher(context), AUTH_SCOPES);
    if (existingSession) {
      // Already authenticated
      return existingSession;
    }

    // Not authenticated yet. Request authentication
    return await authentication.getSession(packagePublisher(context), AUTH_SCOPES, {createIfNone: true}).then((session) => {
      window.showInformationMessage(`You're signed in to Height as ${session.account.label}`);
      return session;
    });
  } catch (e) {
    const errorMessage = messageFromError(e);
    if (errorMessage.includes('User did not consent to login') || errorMessage.includes('User cancelled')) {
      window.showErrorMessage('Height: the extension is not correctly configured', {
        modal: true,
        detail:
          'Since you have denied access to your account, the extension will not work. Please use command "Height: Login" to restart authentication or restart VSCode.',
      });
    } else {
      window.showErrorMessage('Height: an error occurred', {
        modal: true,
        detail: errorMessage,
      });
    }

    return null;
  }
};

const logout = async (authProvider: AuthProvider, context: ExtensionContext) => {
  const sessions = await authProvider.getSessions();
  if (!sessions.length) {
    return;
  }

  await Promise.all(
    sessions.map((session) => {
      const refreshToken = session.accessToken; // Access token is actually refresh token
      const client = createClient(refreshToken, context);
      return Promise.all([
        client.auth.revoke(refreshToken).catch((e) => {
          // Ignore errors
        }),
        authProvider.removeSession(session.id),
      ]);
    }),
  );
};

const cleanupExpiredSessionAndShowError = async (authProvider: AuthProvider, context: ExtensionContext) => {
  // Stop watch and logout
  stopWatch();
  await logout(authProvider, context);

  // Show message
  await window.showErrorMessage('Height: your session has expired.', {
    modal: true,
    detail: 'Your session is not valid anymore. Someone might have revoked it. You need to sign in again to use the extension.',
  });
};

const loginAndWatch = async (authProvider: AuthProvider, context: ExtensionContext) => {
  // Login
  const session = await login(authProvider, context);
  if (!session) {
    return;
  }

  // Start watching
  watcher = new Watcher(session, context);
  watcher.onWatchError(async (event) => {
    switch (event.type) {
      case 'error': {
        if (event.error instanceof ClientError && event.error.code === ClientErrorCode.RefreshTokenInvalid) {
          // Cleanup session and restart
          await cleanupExpiredSessionAndShowError(authProvider, context);
          await loginAndWatch(authProvider, context);
        }

        // Ignore other errors
        break;
      }
      default: {
        switchImpossibleCase(event.type);
      }
    }
  });

  try {
    await watcher.watch();
  } catch (e) {
    if (e instanceof ClientError && e.code === ClientErrorCode.RefreshTokenInvalid) {
      // Cleanup session and restart
      await cleanupExpiredSessionAndShowError(authProvider, context);
      await loginAndWatch(authProvider, context);
    } else {
      // Show error
      await window.showErrorMessage('Height: an error occurred while trying to watch your files', {
        modal: true,
        detail: messageFromError(e),
      });
    }
  }
};

const stopWatch = () => {
  watcher?.dispose();
  watcher = undefined;
};

export function activate(context: ExtensionContext) {
  // Register auth provider
  const authProvider = new AuthProvider(context);
  context.subscriptions.push(authProvider);

  // Bind login/logout commands
  context.subscriptions.push(
    commands.registerCommand('height-vscode.login', async () => {
      stopWatch();
      await logout(authProvider, context);
      await loginAndWatch(authProvider, context);
    }),
  );

  context.subscriptions.push(
    commands.registerCommand('height-vscode.logout', async () => {
      stopWatch();
      await logout(authProvider, context);
      window.showInformationMessage("You're logged out of Height");
    }),
  );

  // Start watch
  loginAndWatch(authProvider, context);
}

export function deactivate() {
  stopWatch();
}
