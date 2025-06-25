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
  Generate a Pull Request description in the following Markdown format based on the provided diff:
  
  ### Description
  
  <!-- Describe your changes in detail -->
  
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
  
  Diff:
  ${diffOutput}`;
  }
  

  async run() {
    try {
        // Validate the event context
        this.validateEventContext();

        // Extract pull request details
        const pullRequestNumber = this.context.payload.pull_request.number;
        const { baseBranch, headBranch } = this.extractBranchRefs();

        // Set up Git configuration and fetch branches
        this.gitHelper.setupGitConfiguration();
        await this.gitHelper.fetchGitBranches(baseBranch, headBranch);

        // Get the diff and generate the PR description
        const diffOutput = this.gitHelper.getGitDiff(baseBranch, headBranch);
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

        // Post a comment with the original description if it exists
        if (currentDescription) {
            await this.postOriginalDescriptionComment(pullRequestNumber, currentDescription);
        }

        // Apply the new pull request description
        await this.applyPullRequestUpdate(pullRequestNumber, generatedDescription);
    } catch (error) {
        // Log the error and rethrow it for higher-level handling
        console.error(`Error updating PR #${pullRequestNumber} description:`, error);
        throw error;
    }
  }Ï

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

  async postOriginalDescriptionComment(pullRequestNumber: number, currentDescription: string) {
    await this.octokit.rest.issues.createComment({
      owner: this.context.repo.owner,
      repo: this.context.repo.repo,
      issue_number: pullRequestNumber,
      body: `**Original description**:\n\n${currentDescription}`
    });
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
