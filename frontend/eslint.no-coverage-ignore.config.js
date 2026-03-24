import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'

const noCoverageIgnoreRule = {
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (/v8 ignore|istanbul ignore|c8 ignore/.test(comment.value)) {
            context.report({
              node: comment,
              message: 'Coverage-ignore comments are banned. Make the code testable instead.',
            })
          }
        }
      },
    }
  },
}

const noCoverageThresholdReductionRule = {
  create(context) {
    const required = new Set(['lines', 'branches', 'functions', 'statements'])
    return {
      'Property[key.name="thresholds"]'(node) {
        const props = node.value.type === 'ObjectExpression' ? node.value.properties : []
        const found = new Set()
        for (const prop of props) {
          const name = prop.key?.name
          if (required.has(name)) {
            found.add(name)
            if (prop.value.type !== 'Literal' || prop.value.value !== 100) {
              context.report({ node: prop, message: `Coverage threshold '${name}' must be 100.` })
            }
          }
        }
        for (const req of required) {
          if (!found.has(req)) {
            context.report({ node, message: `Coverage threshold '${req}' must be explicitly set to 100.` })
          }
        }
      },
    }
  },
}

export default [
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser },
    linterOptions: { reportUnusedDisableDirectives: false },
    plugins: {
      local: {
        rules: {
          'no-coverage-ignore': noCoverageIgnoreRule,
          'no-coverage-threshold-reduction': noCoverageThresholdReductionRule,
        },
      },
      'react-hooks': reactHooks,
    },
    rules: { 'local/no-coverage-ignore': 'error' },
  },
  {
    files: ['vitest.config.ts'],
    rules: { 'local/no-coverage-threshold-reduction': 'error' },
  },
]

