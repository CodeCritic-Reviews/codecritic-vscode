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

export function activate(context: vscode.ExtensionContext): void {
  const extUri = context.extensionUri;

  const sub = (cmd: string, fn: () => void | Promise<void>) =>
    vscode.commands.registerCommand(cmd, () => void fn());

  context.subscriptions.push(
    sub('codecritic.setApiKey', () => setApiKey(context)),
    sub('codecritic.openDashboardApiKey', () => openDashboardApiKey(context)),
    sub('codecritic.reviewSelection', () => reviewSelection(context, extUri)),
    sub('codecritic.reviewActiveFile', () => reviewActiveFile(context, extUri)),
    sub('codecritic.reviewFiles', () => reviewPickedFiles(context, extUri)),
    sub('codecritic.reviewFolder', () => reviewFolder(context, extUri)),
    sub('codecritic.openLastResult', () => openLastResult(context, extUri))
  );
}

export function deactivate(): void {}
