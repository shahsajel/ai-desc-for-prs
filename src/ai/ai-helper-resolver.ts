import { AIHelperInterface, AIHelperParams } from "./types";
import OpenAIHelper from "./open-ai-helper";

const aiHelperResolver = (aiHelperParams: AIHelperParams): AIHelperInterface => { 
    const { aiName } = aiHelperParams;
    switch(aiName) {
        case 'open-ai':
            return new OpenAIHelper(aiHelperParams);
        default:
            throw new Error(`AI Helper ${aiName} not found`);
    }
}

export default aiHelperResolver;
