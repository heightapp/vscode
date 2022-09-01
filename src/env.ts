import dotenv from 'dotenv';

import path from 'path';

// Running here instead of script because VSCode extension is run via launch.json and I'm not sure how to pass -r dotenv/config
if (process.env.NODE_ENV === 'development') {
  dotenv.config({path: path.resolve(__dirname, '../../.env')});
}

// Defaults
const defaultWebHost = 'https://height.app';
const defaultApiHost = 'https://api.height.app';
const defaultAuthClientId = 'aL9IGyJYm4ygMy0k8Sug8mAiYE4SaewGyasS2EcsCkm';

const env = {
  nodeEnv: process.env.NODE_ENV === 'production' ? ('production' as const) : ('development' as const),
  webHost: process.env.HEIGHT_WEB_HOST || defaultWebHost,
  apiHost: process.env.HEIGHT_API_HOST || defaultApiHost,
  authClientId: process.env.HEIGHT_AUTH_CLIENT_ID || defaultAuthClientId,
  authRedirectUri: (() => {
    const url = new URL(process.env.HEIGHT_API_HOST || defaultApiHost);
    url.pathname = 'signin/redirect';
    return url.href;
  })(),
};

export default env;
