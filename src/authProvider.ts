import Client from '@heightapp/client';
import createClient from 'clientHelpers/createClient';
import appEnv from 'env';
import {packageName, packagePublisher} from 'helpers/package';
import difference from 'lodash/difference';
import {v4 as uuid} from 'uuid';
import {
  authentication,
  AuthenticationProvider,
  AuthenticationProviderAuthenticationSessionsChangeEvent,
  AuthenticationSession,
  Disposable,
  env,
  EventEmitter,
  ExtensionContext,
  ProgressLocation,
  Uri,
  UriHandler,
  window,
} from 'vscode';

// Heavily inspired by https://www.eliostruyf.com/create-authentication-provider-visual-studio-code/

const SESSION_KEY = 'sessions';
const AUTH_TIMEOUT = 5 * 60 * 1000; // 5 mins

// heightapp.height/redirect

class UriEventHandler extends EventEmitter<Uri> implements UriHandler {
  public handleUri(uri: Uri) {
    this.fire(uri);
  }
}

class AuthProvider implements AuthenticationProvider, Disposable {
  private sessionChangeEmitter = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
  private disposable: Disposable;
  private authPromiseByScopes = new Map<string, Promise<string>>();
  private uriHandler = new UriEventHandler();

  constructor(private readonly context: ExtensionContext) {
    this.disposable = Disposable.from(
      authentication.registerAuthenticationProvider(packagePublisher(context), packageName(context), this, {supportsMultipleAccounts: false}),
      window.registerUriHandler(this.uriHandler),
    );
  }

  // Required endpoints

  get onDidChangeSessions() {
    return this.sessionChangeEmitter.event;
  }

  async createSession(scopes: readonly string[]): Promise<AuthenticationSession> {
    try {
      // Login and get refresh token
      const refreshToken = await this.login(scopes);
      if (!refreshToken) {
        throw new Error('Login failure');
      }

      // Get user info
      const client = createClient(refreshToken, this.context);
      const user = await client.user.get();

      // Create and store session
      const session: AuthenticationSession = {
        id: uuid(),
        accessToken: refreshToken,
        account: {
          label: user.email,
          id: user.id,
        },
        scopes,
      };
      await this.context.secrets.store(SESSION_KEY, JSON.stringify([session]));

      // Notify
      this.sessionChangeEmitter.fire({added: [session], removed: [], changed: []});
      return session;
    } catch (e) {
      window.showErrorMessage(`Height: sign in failed: ${(e as Error).toString()}`);
      throw e;
    }
  }

  async getSessions(scopes?: readonly string[]): Promise<readonly AuthenticationSession[]> {
    const allSessions = await this.context.secrets.get(SESSION_KEY);

    if (allSessions) {
      try {
        const sessions = JSON.parse(allSessions) as Array<AuthenticationSession>;
        return scopes ? sessions.filter((s) => difference(s.scopes, scopes).length === 0) : sessions;
      } catch {
        return [];
      }
    }

    return [];
  }

  async removeSession(sessionId: string): Promise<void> {
    const allSessions = await this.context.secrets.get(SESSION_KEY);
    if (allSessions) {
      // Parse sessions
      let sessions: Array<AuthenticationSession> = [];
      try {
        sessions = JSON.parse(allSessions) as Array<AuthenticationSession>;
      } catch {
        sessions = [];
      }

      // Find session to remove
      const sessionIndex = sessions.findIndex((s) => s.id === sessionId);
      if (sessionIndex === -1) {
        return;
      }

      // Remove and store sessions
      const session = sessions[sessionIndex];
      sessions.splice(sessionIndex, 1);
      await this.context.secrets.store(SESSION_KEY, JSON.stringify(sessions));

      // Notify
      this.sessionChangeEmitter.fire({added: [], removed: [session], changed: []});
    }
  }

  /**
   * Dispose the registered services
   */
  dispose() {
    this.disposable.dispose();
  }

  /**
   * Log in to Auth0
   */
  private async login(scopes: readonly string[]) {
    return window.withProgress<string>(
      {
        location: ProgressLocation.Notification,
        title: 'Signing in to Height...',
        cancellable: true,
      },
      async (progress, cancellationToken) => {
        const requestId = uuid();
        const {codeVerifier} = await Client.openAuthentication({
          source: 'client',
          clientId: appEnv.authClientId,
          redirectUri: appEnv.authRedirectUri,
          scopes: [...scopes],
          state: {
            requestId,
            sourceApp: 'vscode',
          },
          handleViaRedirectUri: true,
          onOpenUrl: (url) => {
            const uri = Uri.parse(url);
            env.openExternal(uri);
          },
        });

        const scopesKey = scopes.join('-');
        let authPromise = this.authPromiseByScopes.get(scopesKey);
        let authDisposable: Disposable | undefined;
        if (!authPromise) {
          authPromise = new Promise((resolve) => {
            authDisposable = this.uriHandler.event(async (uri) => {
              const refreshToken = await this.handleUri({uri, requestId, codeVerifier, scopes});
              if (refreshToken) {
                resolve(refreshToken);
              }
            });
          });
          this.authPromiseByScopes.set(scopesKey, authPromise);
        }

        try {
          const result = await Promise.race([
            authPromise,
            new Promise<string>((resolve, reject) => {
              setTimeout(() => {
                reject('Login timed out');
              }, AUTH_TIMEOUT);
            }),
            new Promise<string>((resolve, reject) => {
              cancellationToken.onCancellationRequested(() => {
                reject('User cancelled');
              });
            }),
          ]);

          this.authPromiseByScopes.delete(scopesKey);
          authDisposable?.dispose();
          return result;
        } catch (e) {
          this.authPromiseByScopes.delete(scopesKey);
          authDisposable?.dispose();
          throw e;
        }
      },
    );
  }

  private async handleUri({uri, requestId, codeVerifier, scopes}: {uri: Uri; requestId: string; codeVerifier: string; scopes: readonly string[]}) {
    if (uri.path !== '/redirect') {
      return null;
    }

    const query = new URLSearchParams(uri.query);
    const code = query.get('code');
    const stateString = query.get('state');

    if (!code) {
      throw new Error('Missing code in redirect');
    }
    if (!stateString) {
      throw new Error('Missing state in redirect');
    }

    const state = (() => {
      try {
        return JSON.parse(stateString);
      } catch {
        return {};
      }
    })();

    if (state.requestId !== requestId) {
      return null;
    }

    const {refreshToken} = await Client.createTokens({
      clientId: appEnv.authClientId,
      redirectUri: appEnv.authRedirectUri,
      scopes: [...scopes],
      code,
      codeVerifier,
    });

    return refreshToken;
  }
}

export default AuthProvider;
