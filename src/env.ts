import * as dotenv from 'dotenv';

// Load env from file
dotenv.config({path: '../.env'});

// Defaults
const defaultWebHost = 'https://height.app';
const defaultApiHost = 'https://api.height.app';
const defaultAuthClientId = 'aL9IGyJYm4ygMy0k8Sug8mAiYE4SaewGyasS2EcsCkm';

const env = {
  nodeEnv: process.env.NODE_ENV === 'production' ? ('production' as const) : ('development' as const),
  webHost: process.env.WEB_HOST || defaultWebHost,
  apiHost: process.env.API_HOST || defaultApiHost,
  authClientId: process.env.AUTH_CLIENT_ID || defaultAuthClientId,
  authRedirectUri: (() => {
    const url = new URL(process.env.WEB_HOST || defaultWebHost);
    url.pathname = 'signin/success/vscode';
    return url.href;
  })(),
};

export default env;
