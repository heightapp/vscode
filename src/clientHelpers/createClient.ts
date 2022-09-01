import Client from '@heightapp/client';
import appEnv from 'env';
import {ExtensionContext} from 'vscode';

export const AUTH_SCOPES = ['api'];

const createClient = (refreshToken: string, context: ExtensionContext) => {
  return new Client({
    refreshToken,
    clientId: appEnv.authClientId,
    redirectUri: appEnv.authRedirectUri,
    scopes: AUTH_SCOPES,
  });
};

export default createClient;
