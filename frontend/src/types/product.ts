import type { PipelineDefinition } from './pipeline';

export interface Product {
    id: string;
    name: string;
    repoRoot: string;
    systemPromptPath: string;
    knowledgeBasePath: string;
    workingDirectory: string;
    investigationsPath: string;
    pipeline?: PipelineDefinition;
}
