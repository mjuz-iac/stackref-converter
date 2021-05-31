#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const ts = require('ts-morph')

const reposDirectory = 'repos'

translate(reposDirectory)

function translate(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
    const filePath = path.join(directory, entry.name)

    if (entry.isDirectory())
      translate(filePath)
    else if (entry.isFile && path.extname(entry.name) === '.ts') {
      const project = new ts.Project
      const file = project.addSourceFileAtPath(filePath)

      const text = file.getFullText()
      const lineSeparatorRN = (text.match(/\r\n/g) || []).length
      const lineSeparatorR = (text.match(/\r/g) || []).length
      const lineSeparatorN = (text.match(/\n/g) || []).length
      const lineSeparator = lineSeparatorRN > lineSeparatorR
        ? (lineSeparatorRN > lineSeparatorN ? '\r\n' : '\n')
        : (lineSeparatorR > lineSeparatorN ? '\r' : '\n')

      const firstNonImportIndex = file.getStatementsWithComments().findIndex(stat =>
        !(stat instanceof ts.CommentStatement) && !(stat instanceof ts.ImportDeclaration))

      const afterImportsIndex = firstNonImportIndex !== -1 ? firstNonImportIndex : 0

      const variableDeclarations = []
      file.forEachDescendant((node, traversal) => {
        if (node instanceof ts.VariableDeclaration)
          variableDeclarations.push(node)
      })

      const importDeclarations = []
      file.forEachDescendant((node, traversal) => {
        if (node instanceof ts.ImportDeclaration)
          importDeclarations.push(node)
      })

      const parameterDeclarations = []
      file.forEachDescendant((node, traversal) => {
        if (node instanceof ts.ParameterDeclaration)
          parameterDeclarations.push(node)
      })

      const boundIdentifiers =
        variableDeclarations.map(decl => decl.getName()).concat(
        parameterDeclarations.map(decl => decl.getName()),
        importDeclarations.flatMap(decl => {
          const identifiers = decl.getNamedImports().map(specifier => specifier.getText())
          const namespaceImport = decl.getNamespaceImport()
          if (namespaceImport)
            identifiers.push(namespaceImport.getText())
          return identifiers
        }))

      const createUniqueName = (name, index) => {
        const indexedName = index ? name + index : name
        return boundIdentifiers.indexOf(indexedName) !== -1
          ? createUniqueName(name, index ? index + 1 : 2)
          : indexedName
      }

      const mjus = createUniqueName("mjus")


      // find Pulumi import
      const existingPulumiImport = file.getStatementsWithComments().find((decl, index) =>
        decl instanceof ts.ImportDeclaration &&
        index < afterImportsIndex &&
        decl.getModuleSpecifier().getLiteralValue() === '@pulumi/pulumi' &&
        decl.getNamespaceImport()
      )

      const useExistingPulumiImport = !!existingPulumiImport

      const pulumiImport = useExistingPulumiImport
        ? existingPulumiImport.getNamespaceImport().getText()
        : createUniqueName("pulumi")


      // collect StackReference declarations: [{ node, name }]
      const decls = variableDeclarations.reduce((result, decl) => {
        const rhs = decl.getInitializer()

        if (rhs instanceof ts.NewExpression) {
          const call = rhs.getExpression()
          const args = rhs.getArguments()
          const types = rhs.getTypeArguments()

          if (args.length > 0 &&
              types.length == 0 &&
              ((call instanceof ts.Identifier &&
                call.getText() == 'StackReference') ||
               (call instanceof ts.PropertyAccessExpression &&
                call.getExpression().getText() == pulumiImport &&
                call.getName() == 'StackReference'))) {
            if (args.length > 1)
              console.log(
                '[' + filePath + ':' + args[0].getStartLineNumber() + '] ' +
                'Additional arguments to StackReference ignored')
          
            result.push({ node: decl, arg: args[0].getText(), name: decl.getName() })
          }
        }
        
        return result
      }, [])


      // find first Config declaration
      const firstConfig = file.getVariableDeclarations().find(decl => {
        const rhs = decl.getInitializer()

        if (rhs instanceof ts.NewExpression) {
          const call = rhs.getExpression()
          const types = rhs.getTypeArguments()

          return types.length == 0 &&
            call instanceof ts.PropertyAccessExpression &&
            call.getExpression().getText() == pulumiImport &&
            call.getName() == 'Config'
        }
      })

      const useExistingConfig =
        decls.length > 0 &&
        firstConfig &&
        firstConfig.getStart() < decls[0].node.getStart()

      const config = useExistingConfig ? firstConfig.getName() : createUniqueName("config")


      // perform transformations for each StackReference
      decls.map(decl => {
        // collect StackReference usages: [{ node, wishName, identifier, access }]
        const usages = decl.node.findReferencesAsNodes().reduce((result, ref) => {
          if (ref.getParent() && ref.getParent().getParent()) {
            const usage = ref.getParent().getParent()

            if (usage instanceof ts.CallExpression) {
              const call = usage.getExpression()
              const args = usage.getArguments()
              const types = usage.getTypeArguments()
            
              if (args.length > 0 &&
                  types.length == 0 &&
                  (args[0] instanceof ts.StringLiteral ||
                   args[0] instanceof ts.NoSubstitutionTemplateLiteral) &&
                  call instanceof ts.PropertyAccessExpression &&
                  (call.getName() == 'getOutput' ||
                   call.getName() == 'getOutputSync' ||
                   call.getName() == 'getOutputValue' ||
                   call.getName() == 'requireOutput' ||
                   call.getName() == 'requireOutputSync'  ||
                   call.getName() == 'getProvider')) {
                if (args.length > 1)
                  console.log(
                    '[' + filePath + ':' + args[0].getStartLineNumber() + '] ' +
                    'Additional arguments to ' + call.getName() + ' ignored')
                
                const access =
                  call.getName() == 'getProvider' ? 'providers' :
                  call.getName() == 'getOutputSync' || call.getName() == 'requireOutputSync' ? 'wishesSync' :
                  'wishes'

                const value = args[0].getLiteralValue()

                const identifier = value.match(/^[$A-Z_][0-9A-Z_$]*$/i) && !value.match(/^(do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$/)

                result.push({ node: usage, whishName: identifier ? value : args[0].getText(), identifier: identifier, access: access })
              }
              else
              console.log(
                '[' + filePath + ':' + usage.getStartLineNumber() + '] ' +
                'Unexpected usage ' + decl.name + ' ignored')
            }
          }

          return result
        }, [])


        // update AST for wishes
        usages.forEach(usage => {
          if (usage.identifier)
            usage.node.replaceWithText(decl.name + '.' + usage.access + '.' + usage.whishName)
          else
            usage.node.replaceWithText(decl.name + '.' + usage.access + '[' + usage.whishName + ']')
        })

        const indent = lineSeparator + decl.node.getIndentationText()

        const types =
          (usages.length < 4
            ? usages.reduce((result, usage) => result
              ? result + ', ' + usage.whishName + ': any'
              : ' ' + usage.whishName + ': any', '')
            : usages.reduce((result, usage) => result
              ? result + ',' + indent + usage.whishName + ': any'
              : indent + usage.whishName + ': any', ''))
          + ' '

        const configuration =
          "{ host: " + config + ".require('infrastructureHost')" +
          ", port: " + config + ".require('infrastructurePort') }"

        decl.node.setInitializer('new ' + mjus + '.Remote<{' + types + '}>(' + decl.arg + ',' + indent + configuration + ')')
      })


      // update AST for offers
      const exportedNames = file.getExportSymbols().map(v => v.getName())

      if (exportedNames.length > 0) {
        const indent = lineSeparator + (file.getVariableDeclarations().length > 0
          ? file.getVariableDeclarations()[0].getIndentationText()
          : "  ")

        const exports =
          (exportedNames.length < 4
            ? exportedNames.reduce((result, name) => result ? result + ', ' + name : ' ' + name, '')
            : exportedNames.reduce((result, name) => result ? result + ',' + indent + name : indent + name, ''))
          + ' '

        const configuration =
          "{ host: " + config + ".require('infrastructureHost')" +
          ", port: " + config + ".require('infrastructurePort') }"

        const connection =
          "new " + mjus + ".RemoteConnection('connection', " + configuration + ")"

        const statements = file.getStatementsWithComments().reverse()

        const reverseFirstNoCommentIndex = statements.findIndex(stat => !(stat instanceof ts.CommentStatement))

        const lastNoCommentIndex = reverseFirstNoCommentIndex !== -1 ? statements.length - reverseFirstNoCommentIndex : 0

        file.insertStatements(
          lastNoCommentIndex, // workaround
          lineSeparator +
          "new " + mjus + ".Offer(" + indent + connection + ", " + indent + "'offer', {" + exports + "})")
      }


      // update AST for globals
      if (exportedNames.length > 0 || decls.length > 0) {
        const lastImportHasTrailingComment =
          afterImportsIndex > 0 &&
          file.getStatementsWithComments()[afterImportsIndex - 1].getTrailingCommentRanges().length > 0

        if (!useExistingConfig) {
          const lineBreak = lastImportHasTrailingComment ? '' : lineSeparator // workaround
          file.insertStatements(afterImportsIndex, lineBreak + 'const ' + config + ' = new ' + pulumiImport + '.Config()' + lineBreak)
        }

        file.insertStatements(afterImportsIndex, "import * as " + mjus + " from '@mjus/core/resources'")

        if (!useExistingPulumiImport)
          file.insertStatements(afterImportsIndex, "import * as " + pulumiImport + " from '@pulumi/pulumi'")
      }


      file.saveSync()
    }
  })
}
