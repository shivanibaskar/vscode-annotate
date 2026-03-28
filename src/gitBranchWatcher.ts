import * as vscode from 'vscode';

// Minimal type stubs for the built-in vscode.git extension API (version 1).
// We don't depend on @types/vscode-git to avoid a heavy dev-dep; the actual
// runtime object is accessed via `any` and narrowed here.
interface GitBranch {
  name?: string;
}

interface GitRepositoryState {
  HEAD: GitBranch | undefined;
  onDidChange: vscode.Event<void>;
}

interface GitRepository {
  state: GitRepositoryState;
}

interface GitAPI {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
}

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

/**
 * Watches the current git branch in the first workspace repository and emits
 * an event whenever the HEAD branch name changes.
 *
 * Usage:
 * ```ts
 * const watcher = new GitBranchWatcher();
 * watcher.onDidChangeBranch(branch => console.log('switched to', branch));
 * context.subscriptions.push(watcher);
 * ```
 */
export class GitBranchWatcher implements vscode.Disposable {
  private readonly _onDidChangeBranch = new vscode.EventEmitter<string>();
  /** Fires with the new branch name whenever the HEAD branch changes. */
  readonly onDidChangeBranch: vscode.Event<string> = this._onDidChangeBranch.event;

  private _currentBranch: string | undefined;
  private readonly _disposables: vscode.Disposable[] = [];

  constructor() {
    // The git extension may not be active yet; defer initialisation until it is.
    const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExt) {
      return; // git extension unavailable — branch awareness silently disabled
    }

    const init = () => {
      try {
        const api = gitExt.exports.getAPI(1);
        this._attachToRepository(api);

        // If no repo is open yet, wait for one.
        this._disposables.push(
          api.onDidOpenRepository(repo => this._watchRepo(repo))
        );
      } catch {
        // git API unavailable in this environment
      }
    };

    if (gitExt.isActive) {
      init();
    } else {
      gitExt.activate().then(init, () => { /* silently ignore activation failure */ });
    }
  }

  /** Returns the name of the current HEAD branch, or undefined if unknown. */
  get currentBranch(): string | undefined {
    return this._currentBranch;
  }

  private _attachToRepository(api: GitAPI): void {
    const repo = api.repositories[0];
    if (repo) {
      this._currentBranch = repo.state.HEAD?.name;
      this._watchRepo(repo);
    }
  }

  private _watchRepo(repo: GitRepository): void {
    this._disposables.push(
      repo.state.onDidChange(() => {
        const branch = repo.state.HEAD?.name;
        if (branch !== undefined && branch !== this._currentBranch) {
          this._currentBranch = branch;
          this._onDidChangeBranch.fire(branch);
        }
      })
    );
  }

  dispose(): void {
    this._onDidChangeBranch.dispose();
    for (const d of this._disposables) { d.dispose(); }
  }
}
