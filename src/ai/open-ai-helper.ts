import { AIHelperInterface, AIHelperParams } from './types';

class OpenAIHelper implements AIHelperInterface {
  private apiKey: string;
  private temperature: number;

  constructor(aiHelperParams: AIHelperParams) {
    Object.assign(this, aiHelperParams);
  }

  async createPullRequestDescription(diffOutput: string, prompt: string): Promise<string> {
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'o4-mini-2025-04-16',
              messages: [
                {
                  role: 'system',
                  content: 'You are a super assistant, very good at reviewing code, and can generate the best pull request descriptions for engineers.',
                },
                {
                  role: 'user',
                  content: prompt,
                },
              ],
              temperature: this.temperature,
              max_tokens: 1024,
            }),
          });
        
          const data = await response.json();
        
          if (data.error) {
            throw new Error(`OpenAI API Error: ${data.error.message}`);
          }
        
          const description = data.choices[0].message.content.trim();
          return description;
    } catch (error) {
      throw new Error(`OpenAi API Error: ${error.message}`);
    }
  }
}

export default OpenAIHelper;
