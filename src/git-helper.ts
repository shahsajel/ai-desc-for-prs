import { execSync } from 'child_process';

export class GitHelper {
  private ignores?: string;

  constructor(ignores: string | undefined) {
    this.ignores = ignores;
  }

  setupGitConfiguration() {
    execSync(`git config --global user.name "github-actions[bot]"`);
    execSync(`git config --global user.email "github-actions[bot]@users.noreply.github.com"`);
  }

  fetchGitBranches(baseBranch: string, headBranch: string) {
    execSync(`git fetch origin ${baseBranch} ${headBranch}`);
  }

  getGitDiff(baseBranch: string, headBranch: string, eventAction?: string): string {
      // The list of files to ignore to send to AI API
      const defaultIgnoreFiles = [
          ':!**/package-lock.json',
          ':!**/dist/*',
          ':!**/.github/*',
          ':!**/.gitignore',
      ];
  
      const ignoreFiles = this.ignores 
          ? this.ignores.split(',').map(item => `:!${item.trim()}`) // Trim whitespace from items
          : defaultIgnoreFiles;
  
      console.log(`Getting diff for ${eventAction || 'unknown'} event...`);
      console.log('Ignore patterns:', ignoreFiles);
      
      let diffCommand = '';
      
      if (eventAction === 'synchronize') {
        // For synchronize events, only look at the new commits (not the entire branch)
        console.log('Synchronize event: Getting diff for recent commits only');
        
        // Get the diff for just the latest commit(s) - typically the new changes
        diffCommand = `git diff HEAD~1..HEAD -- ${ignoreFiles.join(' ')}`;
        
        try {
          const recentCommits = execSync(`git log --oneline -3`, { encoding: 'utf8' });
          console.log('Recent commits:', recentCommits.trim());
        } catch (error) {
          console.log('Could not get recent commits:', error);
        }
      } else {
        // For opened events, get the full branch diff
        console.log('Opened event: Getting full branch diff');
        diffCommand = `git diff origin/${baseBranch} origin/${headBranch} -- ${ignoreFiles.join(' ')}`;
      }
      
      // First, let's see what files changed
      try {
        const fileCommand = eventAction === 'synchronize' 
          ? `git diff --name-only HEAD~1..HEAD`
          : `git diff --name-only origin/${baseBranch} origin/${headBranch}`;
        const filesChanged = execSync(fileCommand, { encoding: 'utf8' });
        console.log('Changed files:', filesChanged.split('\n').filter(f => f.trim()));
      } catch (error) {
        console.log('Could not get file list:', error);
      }
      
      // Execute the git diff command
      const diffOutput = execSync(diffCommand, { encoding: 'utf8' });
      
      const lineCount = diffOutput.split('\n').length;
      console.log(`Diff output: ${diffOutput ? `Found changed files (${lineCount} lines)` : 'No changes detected'}`);
      
      return diffOutput;
  }
}
