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

  getGitDiff(baseBranch: string, headBranch: string): string {
      // The list of files to ignore to send to AI API
      const defaultIgnoreFiles = [
          ':!**/package-lock.json',
          ':!**/dist/*',       
      ];
  
      const ignoreFiles = this.ignores 
          ? this.ignores.split(',').map(item => `:!${item.trim()}`) // Trim whitespace from items
          : defaultIgnoreFiles;
  
      console.log('Getting diff for changed files (new + modified)...');
      
      // Execute the git diff command to get both new and modified files (but not untouched files)
      const diffOutput = execSync(`git diff origin/${baseBranch} origin/${headBranch} -- ${ignoreFiles.join(' ')}`, { encoding: 'utf8' });
      
      console.log('Diff output:', diffOutput ? 'Found changed files' : 'No changes detected');
      
      return diffOutput;
  }
}
