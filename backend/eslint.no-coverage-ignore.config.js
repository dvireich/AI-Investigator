import tsParser from '@typescript-eslint/parser';
import tseslint from 'typescript-eslint';

const noCoverageIgnoreRule = {
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (/v8 ignore|istanbul ignore|c8 ignore/.test(comment.value)) {
            context.report({
              node: comment,
              message: 'Coverage-ignore comments are banned. Make the code testable instead.',
            });
          }
        }
      },
    };
  },
};

export default [
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser },
    linterOptions: { reportUnusedDisableDirectives: false },
    plugins: {
      local: { rules: { 'no-coverage-ignore': noCoverageIgnoreRule } },
      '@typescript-eslint': tseslint.plugin,
    },
    rules: { 'local/no-coverage-ignore': 'error' },
  },
];

