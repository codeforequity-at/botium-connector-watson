const debug = require('debug')('botium-connector-watson-workspace-to-convo')
const jexl = require('jexl')
const _ = require('lodash')
const fs = require('fs')
const path = require('path')
const slug = require('slug')
const mkdirp = require('mkdirp')

const Convo = require('botium-core/src/scripting/Convo').Convo
const BotDriver = require('botium-core').BotDriver
const Defaults = require('botium-core/src/Defaults')
const Constants = require('botium-core/src/scripting/Constants')

const USER_RESPONSE_ENTITY = 'Options'

const _processJSON = (filename) => {
  const _prepare = (filename) => {
    let rawdata
    try {
      rawdata = fs.readFileSync(filename)
    } catch (err) {
      throw new Error(`FAILED: cant open file!`)
    }
    let workspace
    try {
      workspace = JSON.parse(rawdata)
    } catch (err) {
      throw new Error(`FAILED: cant parse JSON!`)
    }

    if (!workspace.dialog_nodes || !workspace.dialog_nodes.length) {
      throw new Error(`FAILED: no dialog nodes!`)
    }

    let welcomeNodeId
    let mapIdToNode = new Map()
    let mapIdToFirstChildId = new Map()
    let mapIdToNextSiblingId = new Map()

    for (const node of workspace.dialog_nodes) {
      if (node.conditions === 'welcome') {
        welcomeNodeId = node.dialog_node
      }

      mapIdToNode.set(node.dialog_node, { node })
      if (node.parent) {
        if (node.previous_sibling) {
          mapIdToNextSiblingId.set(node.previous_sibling, node.dialog_node)
        } else {
          mapIdToFirstChildId.set(node.parent, node.dialog_node)
        }
      }
    }
    debug(`Read ${mapIdToNode.size} nodes`)

    if (!welcomeNodeId) {
      throw new Error(`FAILED: no welcome node!`)
    }

    debug(`Welcome node found`)

    return {
      welcomeNodeId,
      mapIdToNode,
      mapIdToFirstChildId,
      mapIdToNextSiblingId,
      workspace
    }
  }

  const { welcomeNodeId, mapIdToNode, mapIdToFirstChildId, mapIdToNextSiblingId, workspace } = _prepare(filename)

  /**
   * @param id: node id
   * @param convoStep: because jump more nodes can be oollected to one convoStep
   * @param buttonsConvoStep: because jump more nodes can be oollected to one convoStep. Collect they buttons here
   * @param conversation: array of ConvoSteps in JSON format
   * @param processedIds: used nodes for this convo
   * @param log: how this convo is created (Can be used to reproduce it by human)
   * @param context: same as watson context
   * @param entities: same as watson entities
   * @private
   */
  const _processRecursive = ({ id, convoStep, buttonsConvoStep = [], conversation = [], processedIds = [], log = [], context = {} }) => {
    const nodeStruct = mapIdToNode.get(id)
    if (processedIds.includes(id)) {
      debug(`Node ${id} skipped because already found on path '${processedIds}'`)
      nodeStruct.skippedLeastOnce = true
      return
    }
    const node = nodeStruct.node

    debug(`Processing node '${node.title}' (${node.dialog_node})`)

    if (!node.output || !node.output.generic) {
      throw new Error(`FAILED: node ${id}, incorrect structure, node.output.generic is missing!`)
    }

    if (!buttonsConvoStep) {
      buttonsConvoStep = []
    }
    const _createBotConvoStep = () => {
      return {
        sender: 'bot',
        sourceData: [node],
        stepTag: `Node ${id}`,
        messageTexts: [],
        asserters: []
      }
    }

    if (!convoStep) {
      convoStep = _createBotConvoStep()
    } else {
      convoStep.sourceData.push(node)
      convoStep.stepTag += id
    }

    if (node.context) {
      Object.assign(context, node.context)
      debug(`Context ${JSON.stringify(node.context)} added`)
    }

    const _searchNextNodeId = (button) => {
      // simplified next node search: look just for children
      const jexlContext = {}
      if (button) {
        jexlContext['E_' + USER_RESPONSE_ENTITY] = button.payload
      }

      _.forIn(context, (value, key) => {
        jexlContext['C_' + key] = value
      })

      const _eval = (id) => {
        const node = mapIdToNode.get(id).node
        const conditions = node.conditions
        if (conditions) {
          // examples:
          // @Options:1A || @Options:1B
          // @Options==1A || @Options==1B
          let normalized = conditions
            .replace(new RegExp('@', 'g'), 'E_')
            .replace(new RegExp('\\$', 'g'), 'C_')
            .replace(new RegExp(USER_RESPONSE_ENTITY + ':', 'g'), USER_RESPONSE_ENTITY + '==')
          // examples:
          // C_Options==1A || C_@Options==1B
          // C_Options==1A || C_@Options==1B
          const variableChecks = normalized.match(/==\s*\S*/g)
          if (variableChecks) {
            for (const variableCheck of variableChecks) {
              const replaceWith = variableCheck.replace('==', '=="') + '"'
              normalized = normalized.replace(variableCheck, replaceWith)
            }
          }
          // C_Options=="1A" || C_@Options=="1B"
          // C_Options=="1A" || C_@Options=="1B"
          try {
            if (jexl.evalSync(normalized, jexlContext)) {
              return node.dialog_node
            }
          } catch (err) {
            throw new Error(`FAILED: node ${childId}, cant evaluate conditions (${conditions}!`)
          }
        }
      }
      let childId = mapIdToFirstChildId.get(id)
      while (childId) {
        if (_eval(childId)) {
          return childId
        }
        childId = mapIdToNextSiblingId.get(childId)
      }

      let nextSiblingId = mapIdToNextSiblingId.get(id)
      while (nextSiblingId) {
        if (_eval(nextSiblingId)) {
          return nextSiblingId
        }
        nextSiblingId = mapIdToNextSiblingId.get(nextSiblingId)
      }
      return null
    }

    const _finishBotConvoStep = () => {
      debug(`Convo step finished`)

      // dealing with bot message
      if (convoStep.messageTexts.length || convoStep.asserters.length) {
        if (convoStep.messageTexts.length) {
          convoStep.messageText = convoStep.messageTexts.join('\n')
        }
        delete convoStep.messageTexts
        conversation.push(convoStep)
      } else {
        debug(`Convo step is not created for '${convoStep.stepTag}' because there are no messages and asserters`)
      }
    }

    // extracting convoStep
    let lastResponseType
    for (const msg of node.output.generic) {
      switch (msg.response_type) {
        case 'text':
          // two msgs are sometimes one response, sometimes two for Watson. Trying to follow its behavior. Maybe two text responses after each other?
          if (lastResponseType === 'text') {
            _finishBotConvoStep()
            convoStep = _createBotConvoStep()
          }
          // they have one random, but it has just one random selection, but there is just one message
          if (msg.selection_policy !== 'sequential' && msg.length > 1) {
            throw new Error(`FAILED: node ${id}, field node.output.generic.selection_policy value (${msg.selection_policy} with more responses is not supported!`)
          }

          convoStep.messageTexts.push(...msg.values.map(value => value.text))
          break
        case 'option':
          const buttonsLocal = msg.options.map(o => {
            return {
              text: o.label,
              payload: o.value && o.value.input && o.value.input.text
            }
          })
          convoStep.asserters.push({ name: 'BUTTONS', args: buttonsLocal.map(button => button.text) })
          buttonsConvoStep = buttonsConvoStep.concat(buttonsLocal)
          _finishBotConvoStep()
          convoStep = _createBotConvoStep()
          break
        case 'image':
          convoStep.asserters.push({ name: 'MEDIA', args: [msg.source] })
          _finishBotConvoStep()
          convoStep = _createBotConvoStep()
          break
        case 'pause':
          break
        default:
          throw new Error(`FAILED: node ${id}, field node.output.generic.response_type value (${msg.response_type} is not supported!`)
      }
      lastResponseType = msg.response_type
    }

    // processed overall (are not processed nodes?)
    nodeStruct.processed = true
    // processed for this convoStep (detect endless loop)
    processedIds.push(id)
    log.push({ processedNode: { nodeId: id, nodeTitle: node.title } })

    // deciding what to do next
    if (!node.next_step) {
      // if next_step is not set, it means wait for user input
      _finishBotConvoStep()

      if (!buttonsConvoStep.length) {
        // throw new Error(`FAILED: node ${id}, wait for user input works just if there are options defined before!`)
        debug(`CONVERSATION FINISHED with question`)
        return [{ conversation, log }]
      }

      // generate all user response with corresponding node
      const nodesToGo = new Map()
      const buttonsAndResponses = buttonsConvoStep.map(button => {
        let newNodeId = _searchNextNodeId(button)
        if (!newNodeId) {
          throw new Error(`FAILED: node ${id}, no user response found for user message ${JSON.stringify(button)}!`)
        }
        if (nodesToGo.has(newNodeId)) {
          debug(`User response ${JSON.stringify(button)} is ignored because it is same as ${JSON.stringify(nodesToGo.get(newNodeId))}`)
          return { button, newNode: null }
        }

        nodesToGo.set(newNodeId, button)
        return { button, newNodeId }
      })

      debug(`Created ${buttonsAndResponses.filter(buttonsAndResponse => buttonsAndResponse.newNodeId).length} branches from ${buttonsConvoStep.length} buttonsConvoStep`)

      // and execute user responses
      const branches = []
      for (const { button, newNodeId } of buttonsAndResponses) {
        if (!newNodeId) {
          continue
        }
        log.push({ userPushed: { button } })
        const newConversation = conversation.concat([{
          sender: 'me',
          messageText: '',
          userInputs: [{
            name: 'BUTTON',
            args: [button.payload]
          }]
        }])

        const processed = _processRecursive({
          id: newNodeId,
          conversation: newConversation,
          processedIds: [...processedIds],
          log: [...log],
          context: Object.assign({}, context)
        })
        if (processed) {
          branches.push(...processed)
        }
      }
      return branches
    } else {
      switch (node.next_step.behavior) {
        case 'jump_to':
          // jump does not finishes the current ConvoStep
          if (node.next_step.selector !== 'body') {
            throw new Error(`FAILED: node ${id}, jump_to selector (${node.next_step.selector}) is not supported!`)
          }
          const jumpTo = node.next_step.dialog_node
          return _processRecursive({
            id: jumpTo,
            convoStep,
            buttonsConvoStep,
            conversation,
            // clone is not required here
            processedIds: [...processedIds],
            log: [...log],
            context: Object.assign({}, context)
          })
        case 'skip_user_input':
          // dont request user response, just execute children
          let newNodeId = _searchNextNodeId()
          if (!newNodeId) {
            throw new Error(`FAILED: node ${id}, no user response found!`)
          }
          _finishBotConvoStep()
          return _processRecursive({
            id: newNodeId,
            conversation,
            // clone is not required here
            processedIds: [...processedIds],
            log: [...log],
            context: Object.assign({}, context)
          })
        default:
          throw new Error(`FAILED: node ${id}, not supported next_step.behavior '${node.next_step.behavior}'!`)
      }
    }
  }

  return { conversationsAndLogs: _processRecursive({ id: welcomeNodeId }), workspace, mapIdToNode }
}

const handler = ({ inputJson, outputDir }) => {
  const { conversationsAndLogs, workspace, mapIdToNode } = _processJSON(inputJson)

  const _write = () => {
    const skippedLeastOnceNodes = []
    const notProcessedNodes = []
    mapIdToNode.forEach((value, key) => {
      if (value.skippedLeastOnce) {
        skippedLeastOnceNodes.push({ id: key, title: value.node.title })
      }
      if (!value.processed) {
        notProcessedNodes.push({ id: key, title: value.node.title, condition: value.node.conditions })
      }
    })

    const driver = new BotDriver(Defaults)
    const compiler = driver.BuildCompiler()

    debug(`----------------`)
    debug(`Process finished`)
    debug(`All nodes: ${mapIdToNode.size}`)
    debug(`Processed: ${mapIdToNode.size - notProcessedNodes.length}`)
    debug(`Created conversations: ${conversationsAndLogs.length}`)

    debug(`Recursive nodes: ${skippedLeastOnceNodes.length ? JSON.stringify(skippedLeastOnceNodes) : 'none'}`)
    debug(`Not processed nodes: ${notProcessedNodes.length ? JSON.stringify(notProcessedNodes) : 'none'}`)

    debug(`All user choiches will be put into '${USER_RESPONSE_ENTITY}' entity`)
    debug(`Writing convos:`)

    for (let i = 0; i < conversationsAndLogs.length; i++) {
      const convoId = i.toString().padStart(3, '0')
      const { conversation, log } = conversationsAndLogs[i]
      const convoAsJson = {
        header: {
          name: `${workspace.name}${convoId}`,
          description: '[\n' + log.map(entry => JSON.stringify(entry)).join(',\n') + ']'
        },
        conversation
      }

      const convo = new Convo({}, convoAsJson)

      const convoAsTxt = compiler.Decompile([convo], Constants.SCRIPTING_FORMAT_TXT)

      mkdirp(outputDir)
      fs.writeFile(path.join(outputDir, `${slug(workspace.name)}${convoId}.convo.txt`), convoAsTxt, (err) => {
        if (err) {
          return console.log(err)
        }

        process.stdout.write('.')
      })
    }
  }

  _write()
}

handler({ inputJson: process.argv[2], outputDir: process.argv[3] })
