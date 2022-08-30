import {ExtensionContext} from 'vscode';

export const packagePublisher = (context: ExtensionContext): string => {
  return context.extension.packageJSON.publisher ?? '';
};

export const packageName = (context: ExtensionContext): string => {
  return context.extension.packageJSON.name ?? '';
};
