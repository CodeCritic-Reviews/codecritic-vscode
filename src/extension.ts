import * as vscode from 'vscode';
import {
  openDashboardApiKey,
  openLastResult,
  reviewActiveFile,
  reviewFolder,
  reviewPickedFiles,
  reviewSelection,
  setApiKey,
} from './review/runReviewCommands';
import { HomeViewProvider } from './sidebar/homeViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const extUri = context.extensionUri;

  const sub = (cmd: string, fn: () => void | Promise<void>) =>
    vscode.commands.registerCommand(cmd, () => void fn());

  const home = new HomeViewProvider(extUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(HomeViewProvider.viewType, home, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    sub('codecritic.setApiKey', () => setApiKey(context)),
    sub('codecritic.openDashboardApiKey', () => openDashboardApiKey(context)),
    sub('codecritic.reviewSelection', () => reviewSelection(context, extUri)),
    sub('codecritic.reviewActiveFile', () => reviewActiveFile(context, extUri)),
    sub('codecritic.reviewFiles', () => reviewPickedFiles(context, extUri)),
    sub('codecritic.reviewFolder', () => reviewFolder(context, extUri)),
    sub('codecritic.openLastResult', () => openLastResult(context, extUri)),
    sub('codecritic.focusHome', () =>
      vscode.commands.executeCommand('codecritic.home.focus')
    )
  );
}

export function deactivate(): void {}
