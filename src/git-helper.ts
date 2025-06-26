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
        
        try {
          const recentCommits = execSync(`git log --oneline -3`, { encoding: 'utf8' });
          console.log('Recent commits:', recentCommits.trim());
          
          // Check if the latest commit is a merge commit
          const parentCount = execSync(`git rev-list --count --parents HEAD^..HEAD`, { encoding: 'utf8' }).trim();
          const parents = execSync(`git rev-list --parents -n 1 HEAD`, { encoding: 'utf8' }).trim().split(' ');
          
          console.log(`Parent count: ${parentCount}, Parents: ${parents.length - 1}`);
          
          if (parents.length > 2) {
            // This is a merge commit - use git show to see only what the merge introduced
            console.log('Merge commit detected: Using git show HEAD');
            diffCommand = `git show HEAD --format="" -- ${ignoreFiles.join(' ')}`;
          } else {
            // Regular commit: just get the diff from previous commit
            console.log('Regular commit: Using HEAD~1..HEAD');
            diffCommand = `git diff HEAD~1..HEAD -- ${ignoreFiles.join(' ')}`;
          }
        } catch (error) {
          console.log('Could not determine commit type, using default diff:', error);
          diffCommand = `git diff HEAD~1..HEAD -- ${ignoreFiles.join(' ')}`;
        }
      } else {
        // For opened events, get the full branch diff
        console.log('Opened event: Getting full branch diff');
        diffCommand = `git diff origin/${baseBranch} origin/${headBranch} -- ${ignoreFiles.join(' ')}`;
      }
      
      // For synchronize events, also show what files were actually modified in the latest commit
      if (eventAction === 'synchronize') {
        try {
          const filesInCommit = execSync(`git show --name-only --format="" HEAD`, { encoding: 'utf8' });
          console.log('Files in latest commit:', filesInCommit.split('\n').filter(f => f.trim()));
        } catch (error) {
          console.log('Could not get files in commit:', error);
        }
      }
      
      // Execute the git diff command
      const diffOutput = execSync(diffCommand, { encoding: 'utf8' });
      
      const lineCount = diffOutput.split('\n').length;
      console.log(`Diff output: ${diffOutput ? `Found changed files (${lineCount} lines)` : 'No changes detected'}`);
      
      return diffOutput;
  }
}
