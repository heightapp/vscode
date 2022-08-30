import Client from '@heightapp/client';
import AuthProvider from 'authProvider';
import {AUTH_SCOPES} from 'clientHelpers/createClient';
import appEnv from 'env';
import {packagePublisher} from 'helpers/package';
import switchImpossibleCase from 'helpers/switchImpossibleCase';
import {authentication, ExtensionContext, window} from 'vscode';
import Watcher from 'watcher';

// Setup client for development
if (appEnv.nodeEnv === 'development') {
  Client.setupHostsForDev({
    apiHost: appEnv.apiHost,
    webHost: appEnv.webHost,
  });
}

let watcher: Watcher | undefined;

const startWatch = async (authProvider: AuthProvider, context: ExtensionContext) => {
  // Get sessions or request authentication
  watcher = await authentication.getSession(packagePublisher(context), AUTH_SCOPES).then(async (existingSession) => {
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

  watcher.onWatchError(async (event) => {
    switch (event.type) {
      case 'invalidToken': {
        // Show message
        window.showErrorMessage('Your session has expired. Please sign in again.');

        // Clear session
        if (watcher) {
          await authProvider.removeSession(watcher.session.id);
          watcher.dispose();
        }

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
};

export function activate(context: ExtensionContext) {
  // Register auth provider
  const authProvider = new AuthProvider(context);
  context.subscriptions.push(authProvider);

  // Start watch
  startWatch(authProvider, context);
}

export function deactivate() {
  watcher?.dispose();
}
