import { getInput, setOutput, setFailed } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { GitHelper } from './git-helper';
import aiHelperResolver from './ai/ai-helper-resolver';
import { AIHelperInterface } from './ai/types';

class PullRequestUpdater {
  private gitHelper: GitHelper;
  private context: any;
  private aiHelper: AIHelperInterface;
  private octokit: any;
  private readonly DESCRIPTION_IDENTIFIER = '### Description';

  constructor() {
    this.gitHelper = new GitHelper(getInput('ignores'));
    this.context = context;
    this.aiHelper = aiHelperResolver({
      apiKey: getInput('api_key', { required: true }),
      aiName: getInput('ai_name', { required: true }),
      temperature: parseFloat(getInput('temperature') || '0.8'),
    });
    const githubToken = getInput('github_token', { required: true });
    this.octokit = getOctokit(githubToken);
  }

  private generatePrompt(diffOutput: string): string {
    return `Instructions:
  Generate a Pull Request description in the following Markdown format based on the provided diff. Only generate the description, no other text.:
  
  ### Description
  
  <!-- Describe changes based on the diff in detail -->
  
  Diff:
  ${diffOutput}
  
  #### Type of change
  
  <!-- Check all that apply -->
  <!-- \"New feature\" should include upgrading packages in our base Python image (follow instructions here: https://www.notion.so/hexhq/Bumping-Python-Packages-dad4c9efd9654f5d9f1c3cf38d73e896) -->
  
  - [ ] Bug fix <!-- change that fixes an issue -->
  - [ ] UI Polish <!-- change that polishes/enhances UI -->
  - [ ] New feature <!-- change that adds functionality -->
  - [ ] Refactor <!-- behind-the-scenes code changes with no user-facing changes -->
  - [ ] Non-product change <!-- documentation updates, change that only affects tests, etc. -->
  - [ ] Breaking <!-- fix or feature that would cause existing functionality to not work as expected -->
  
  #### Related
  
  - Fixes: {Issue ID} <!-- issue will automatically be closed on merge -->
  - References: {Issue ID} <!-- issue will only be linked, not closed -->
  
  <!-- List out any links, issues, or PRs here that provide additional context -->
  <!-- If this PR fixes multiple issues, list them here -->
  <!-- Replace '{Issue ID}' with the appropriate issue ID from Linear -->
  
  ### Screenshots
  
  <!-- Should be included for any UI/UX changes, otherwise remove this section -->
  
  ### Testing
  
  <!-- Describe your test cases or why this doesn't require testing (e.g. already covered by tests) -->
  
  <details>
  <summary><h3>CR checklist</h3></summary>
  
  By approving this PR, I have verified the following:
  
  - Correctness: Does this PR correctly implement the described change? Are there any unintended effects?
  - Code style: is this consistent with the rest of the codebase?
  - Security: Are there any security implications of this change, e.g. [OWASP Top 10](https://owasp.org/www-project-top-ten/)
  - Infrastructure: Does this change have any security implications for the infrastructure, e.g. networking changes
  </details>
`;
  }

  private analyzeChangesSignificance(diffOutput: string): { isSignificant: boolean; reason: string } {
    const lines = diffOutput.split('\n');
    const addedLines = lines.filter(line => line.startsWith('+')).length;
    const deletedLines = lines.filter(line => line.startsWith('-')).length;
    const totalChangedLines = addedLines + deletedLines;
    
    // Count files changed (new + modified files)
    const filesChanged = (diffOutput.match(/^diff --git/gm) || []).length;
    
    // Check for significant patterns
    const hasNewFunctions = /^\+.*(?:function|def|class|interface|type)\s+\w+/gm.test(diffOutput);
    const hasImportChanges = /^\+.*(?:import|from|require)\s+/gm.test(diffOutput);
    const hasConfigChanges = /^diff --git.*\.(json|yml|yaml|toml|ini|config)$/gm.test(diffOutput);
    
    // No files changed
    if (filesChanged === 0 || !diffOutput.trim()) {
      return { isSignificant: false, reason: 'No files changed' };
    }
    
    // Determine significance based on multiple factors
    if (totalChangedLines >= 50) {
      return { isSignificant: true, reason: `Large change detected: ${totalChangedLines} lines changed` };
    }
    
    if (filesChanged >= 5) {
      return { isSignificant: true, reason: `Multiple files changed: ${filesChanged} files` };
    }
    
    if (hasNewFunctions) {
      return { isSignificant: true, reason: 'New functions/classes/interfaces added' };
    }
    
    if (hasImportChanges) {
      return { isSignificant: true, reason: 'Import/dependency changes detected' };
    }
    
    if (hasConfigChanges) {
      return { isSignificant: true, reason: 'Configuration file changes detected' };
    }
    
    if (totalChangedLines >= 20) {
      return { isSignificant: true, reason: `Moderate change detected: ${totalChangedLines} lines changed in ${filesChanged} files` };
    }
    
    return { isSignificant: false, reason: `Minor change: only ${totalChangedLines} lines changed in ${filesChanged} files` };
  }

  async run() {
    try {
        // Validate the event context
        this.validateEventContext();

        // Extract pull request details
        const pullRequestNumber = this.context.payload.pull_request.number;
        const { baseBranch, headBranch } = this.extractBranchRefs();
        const eventAction = this.context.payload.action; // 'opened' or 'synchronize'

        console.log(`PR #${pullRequestNumber} - Event: ${eventAction}`);

        // Set up Git configuration and fetch branches
        this.gitHelper.setupGitConfiguration();
        await this.gitHelper.fetchGitBranches(baseBranch, headBranch);

        // Get the diff and analyze changes
        const diffOutput = this.gitHelper.getGitDiff(baseBranch, headBranch);
        
        // For synchronize events, check if changes are significant enough
        if (eventAction === 'synchronize') {
          const { isSignificant, reason } = this.analyzeChangesSignificance(diffOutput);
          console.log(`Change analysis: ${reason}`);
          
          if (!isSignificant) {
            console.log('Changes are not significant enough to update PR description. Skipping update.');
            setOutput('pr_number', pullRequestNumber.toString());
            setOutput('description', 'No update - changes not significant');
            return;
          }
          
          console.log('Significant changes detected. Updating PR description...');
        }

        // Generate new description and update PR
        const prompt = this.generatePrompt(diffOutput);
        const generatedDescription = await this.aiHelper.createPullRequestDescription(diffOutput, prompt);

        // Update the pull request description
        await this.updatePullRequestDescription(pullRequestNumber, generatedDescription);

        // Set outputs for GitHub Actions
        setOutput('pr_number', pullRequestNumber.toString());
        setOutput('description', generatedDescription);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setFailed(errorMessage);
        console.error(`Error updating PR: ${errorMessage}`);
    }
  }

  validateEventContext() {
    if (this.context.eventName !== 'pull_request') {
      setFailed('This action should only runs on pull_request events.');
      throw new Error('Invalid event context');
    }
  }

  extractBranchRefs() {
    const baseBranch = this.context.payload.pull_request.base.ref;
    const headBranch = this.context.payload.pull_request.head.ref;
    return { baseBranch, headBranch };
  }

  async updatePullRequestDescription(pullRequestNumber: number, generatedDescription: string) {
    try {
        // Fetch pull request details
        const pullRequest = await this.fetchPullRequestDetails(pullRequestNumber);
        const currentDescription = pullRequest.body || '';

        // Handle original description comment (create or update)
        if (currentDescription) {
            await this.handleOriginalDescriptionComment(pullRequestNumber, currentDescription);
        }

        // Apply the new pull request description
        await this.applyPullRequestUpdate(pullRequestNumber, generatedDescription);
    } catch (error) {
        // Log the error and rethrow it for higher-level handling
        console.error(`Error updating PR #${pullRequestNumber} description:`, error);
        throw error;
    }
  }

  async fetchPullRequestDetails(pullRequestNumber: number) {
    const { data } = await this.octokit.rest.pulls.get({
      owner: this.context.repo.owner,
      repo: this.context.repo.repo,
      pull_number: pullRequestNumber,
    });
    return data;
  }

  extractBranchName(): string {
    return this.context.payload.pull_request.head.ref.replace('feat/', '').replace('fix/', '');
  }

  async findExistingBotComment(pullRequestNumber: number): Promise<any | null> {
    try {
      const { data: comments } = await this.octokit.rest.issues.listComments({
        owner: this.context.repo.owner,
        repo: this.context.repo.repo,
        issue_number: pullRequestNumber,
      });

      // Find comment that contains "### Description" (our AI-generated format)
      const botComment = comments.find(comment => {
        if (!comment.body) return false;
        
        // Look for our markdown header format
        const body = comment.body.trim();
        const hasDescriptionHeader = body.includes('### Description') || body.startsWith('Description\n');
        
        // Also check if it was posted by github-actions bot
        
        // Additional check for typical AI-generated content structure
        const hasTypicalStructure = body.includes('This pull request') || body.includes('Type of change') || body.includes('### Testing');
        
        return hasDescriptionHeader  && hasTypicalStructure;
      });

      if (botComment) {
        console.log(`Found existing bot comment #${botComment.id}`);
      } else {
        console.log('No existing bot comment found');
      }

      return botComment || null;
    } catch (error) {
      console.error('Error finding existing bot comment:', error);
      return null;
    }
  }

  async handleOriginalDescriptionComment(pullRequestNumber: number, currentDescription: string) {
    try {
      const existingComment = await this.findExistingBotComment(pullRequestNumber);

      if (existingComment) {
        // Update existing comment
        console.log(`Updating existing bot comment #${existingComment.id}`);
        await this.octokit.rest.issues.updateComment({
          owner: this.context.repo.owner,
          repo: this.context.repo.repo,
          comment_id: existingComment.id,
          body: currentDescription
        });
      } else {
        // Create new comment
        console.log('Creating new bot comment');
        await this.octokit.rest.issues.createComment({
          owner: this.context.repo.owner,
          repo: this.context.repo.repo,
          issue_number: pullRequestNumber,
          body: currentDescription
        });
      }
    } catch (error) {
      console.error('Error handling original description comment:', error);
      throw error;
    }
  }

  async applyPullRequestUpdate(pullRequestNumber: number, newDescription: string) {
    await this.octokit.rest.pulls.update({
      owner: this.context.repo.owner,
      repo: this.context.repo.repo,
      pull_number: pullRequestNumber,
      body: newDescription,
    });
  }
}

export default PullRequestUpdater;
