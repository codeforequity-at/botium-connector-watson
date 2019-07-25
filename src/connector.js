const util = require('util')
const async = require('async')
const _ = require('lodash')
const AssistantV1 = require('watson-developer-cloud/assistant/v1')
const AssistantV2 = require('watson-developer-cloud/assistant/v2')
const debug = require('debug')('botium-connector-watson')

const Capabilities = {
  WATSON_ASSISTANT_VERSION: 'WATSON_ASSISTANT_VERSION',
  WATSON_URL: 'WATSON_URL',
  WATSON_VERSION: 'WATSON_VERSION',
  WATSON_APIKEY: 'WATSON_APIKEY',
  WATSON_USER: 'WATSON_USER',
  WATSON_PASSWORD: 'WATSON_PASSWORD',
  WATSON_WORKSPACE_ID: 'WATSON_WORKSPACE_ID',
  WATSON_ASSISTANT_ID: 'WATSON_ASSISTANT_ID',
  WATSON_COPY_WORKSPACE: 'WATSON_COPY_WORKSPACE',
  WATSON_FORCE_INTENT_RESOLUTION: 'WATSON_FORCE_INTENT_RESOLUTION'
}

const Defaults = {
  [Capabilities.WATSON_ASSISTANT_VERSION]: 'V1',
  [Capabilities.WATSON_URL]: 'https://gateway.watsonplatform.net/assistant/api',
  [Capabilities.WATSON_VERSION]: '2019-02-28',
  [Capabilities.WATSON_COPY_WORKSPACE]: false,
  [Capabilities.WATSON_FORCE_INTENT_RESOLUTION]: false
}

class BotiumConnectorWatson {
  constructor ({ queueBotSays, caps }) {
    this.queueBotSays = queueBotSays
    this.caps = caps
  }

  Validate () {
    debug('Validate called')
    this.caps = Object.assign({}, Defaults, this.caps)

    if (!this.caps[Capabilities.WATSON_URL]) throw new Error('WATSON_URL capability required')
    if (!this.caps[Capabilities.WATSON_APIKEY]) {
      if (!this.caps[Capabilities.WATSON_USER]) throw new Error('WATSON_USER capability required (or use WATSON_APIKEY)')
      if (!this.caps[Capabilities.WATSON_PASSWORD]) throw new Error('WATSON_PASSWORD capability required (or use WATSON_APIKEY)')
    }
    if (!this.caps[Capabilities.WATSON_VERSION]) throw new Error('WATSON_VERSION capability required')

    if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1') {
      if (!this.caps[Capabilities.WATSON_WORKSPACE_ID]) throw new Error('WATSON_WORKSPACE_ID capability required for V1')
    } else if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V2') {
      if (!this.caps[Capabilities.WATSON_ASSISTANT_ID]) throw new Error('WATSON_ASSISTANT_ID capability required for V2')
      if (this.caps[Capabilities.WATSON_COPY_WORKSPACE]) throw new Error('WATSON_COPY_WORKSPACE capability only valid for V1')
    } else {
      throw new Error('WATSON_ASSISTANT_VERSION capability has to be one of: V1,V2')
    }

    return Promise.resolve()
  }

  Build () {
    debug('Build called')
    return new Promise((resolve, reject) => {
      async.series([
        (assistantReady) => {
          const opts = {
            url: this.caps[Capabilities.WATSON_URL],
            version: this.caps[Capabilities.WATSON_VERSION]
          }
          if (this.caps[Capabilities.WATSON_APIKEY]) {
            Object.assign(opts, { iam_apikey: this.caps[Capabilities.WATSON_APIKEY] })
          } else {
            Object.assign(opts, {
              username: this.caps[Capabilities.WATSON_USER],
              password: this.caps[Capabilities.WATSON_PASSWORD]
            })
          }
          if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1') {
            this.assistant = new AssistantV1(opts)
          } else if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V2') {
            this.assistant = new AssistantV2(opts)
          }
          assistantReady()
        },

        (workspaceCopied) => {
          if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1') {
            if (this.caps[Capabilities.WATSON_COPY_WORKSPACE]) {
              this.assistant.getWorkspace({ workspace_id: this.caps[Capabilities.WATSON_WORKSPACE_ID], export: true }, (err, workspace) => {
                if (err) {
                  workspaceCopied(`Watson workspace connection failed: ${util.inspect(err)}`)
                } else {
                  this.assistant.createWorkspace(workspace, (err, workspaceCopy) => {
                    if (err) {
                      workspaceCopied(`Watson workspace copy failed: ${util.inspect(err)}`)
                    } else {
                      debug(`Watson workspace copied: ${util.inspect(workspaceCopy)}`)
                      this.useWorkspaceId = workspaceCopy.workspace_id
                      workspaceCopied()
                    }
                  })
                }
              })
            } else {
              this.useWorkspaceId = this.caps[Capabilities.WATSON_WORKSPACE_ID]
              workspaceCopied()
            }
          } else {
            workspaceCopied()
          }
        },

        (workspaceAvailableReady) => {
          if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1' && this.caps[Capabilities.WATSON_COPY_WORKSPACE]) {
            let workspaceAvailable = false

            async.until(
              () => workspaceAvailable,
              (workspaceChecked) => {
                debug(`Watson checking workspace status ${this.useWorkspaceId} before proceed`)

                this.assistant.getWorkspace({ workspace_id: this.useWorkspaceId }, (err, workspace) => {
                  if (err) {
                    workspaceChecked(`Watson workspace connection failed: ${util.inspect(err)}`)
                  } else {
                    debug(`Watson workspace connected, checking for status 'Available': ${util.inspect(workspace)}`)
                    if (workspace.status === 'Available') {
                      workspaceAvailable = true
                      workspaceChecked()
                    } else {
                      debug(`Watson workspace waiting for status 'Available'`)
                      setTimeout(workspaceChecked, 10000)
                    }
                  }
                })
              },
              (err) => {
                if (err) return workspaceAvailableReady(err)
                workspaceAvailableReady()
              })
          } else {
            workspaceAvailableReady()
          }
        }

      ], (err) => {
        if (err) {
          return reject(new Error(`Cannot build watson container: ${util.inspect(err)}`))
        }
        resolve(this)
      })
    })
  }

  async Start () {
    debug('Start called')
    this.conversationContext = {}
    if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V2') {
      const createSession = util.promisify(this.assistant.createSession).bind(this.assistant)
      try {
        const createSessionResponse = await createSession({ assistant_id: this.caps[Capabilities.WATSON_ASSISTANT_ID] })
        this.sessionId = createSessionResponse.session_id
        debug(`Created Watson session ${this.sessionId}`)
      } catch (err) {
        throw new Error(`Failed to create Watson session: ${util.inspect(err)}`)
      }
    }
  }

  async UserSays (msg) {
    debug('UserSays called')
    if (!this.assistant) throw new Error('not built')

    const getInputPayload = () => {
      if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1') {
        return {
          workspace_id: this.useWorkspaceId,
          context: this.conversationContext || {},
          input: { text: msg.messageText },
          alternate_intents: true
        }
      } else if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V2') {
        return {
          assistant_id: this.caps[Capabilities.WATSON_ASSISTANT_ID],
          session_id: this.sessionId,
          input: {
            message_type: 'text',
            text: msg.messageText,
            options: {
              return_context: true
            }
          },
          context: this.conversationContext || {}
        }
      }
    }
    const handleResponse = async (sendMessageResponse) => {
      if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1') {
        this.conversationContext = sendMessageResponse.context
        await this._processWatsonResponse(sendMessageResponse,
          sendMessageResponse.output.generic,
          sendMessageResponse.intents,
          sendMessageResponse.entities)
      } else if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V2') {
        this.conversationContext = { skills: sendMessageResponse.context.skills }
        await this._processWatsonResponse(sendMessageResponse,
          sendMessageResponse.output.generic,
          sendMessageResponse.output.intents,
          sendMessageResponse.output.entities)
      }
    }

    const sendMessage = util.promisify(this.assistant.message).bind(this.assistant)
    let sendMessageResponse = {}
    try {
      const inputPayload = getInputPayload()
      debug(`Watson request: ${JSON.stringify(inputPayload, null, 2)}`)
      sendMessageResponse = await sendMessage(inputPayload)
      debug(`Watson response: ${JSON.stringify(sendMessageResponse, null, 2)}`)
    } catch (err) {
      throw new Error(`Cannot send message to watson container: ${util.inspect(err)}`)
    }
    await handleResponse(sendMessageResponse)
  }

  async _processWatsonResponse (sendMessageResponse, generic, intents, entities) {
    if (intents && intents.length > 1 && intents[0].confidence === intents[1].confidence) {
      throw new Error(`Got duplicate intent confidence ${util.inspect(intents[0])} vs ${util.inspect(intents[1])}`)
    }
    const nlp = {
      intent: intents && intents.length > 1 ? {
        name: intents[0].intent,
        confidence: intents[0].confidence,
        intents: intents.map((intent) => { return { name: intent.intent, confidence: intent.confidence } })
      } : {},
      entities: entities && entities.length > 1 ? entities.map((entity) => { return { name: entity.entity, value: entity.value, confidence: entity.confidence } }) : []
    }

    let forceIntentResolution = this.caps[Capabilities.WATSON_FORCE_INTENT_RESOLUTION]

    let texts = generic && generic.filter(g => g.response_type === 'text')
      .reduce((acc, g) => {
        if (_.isArray(g.text)) {
          return acc.concat(g.text.filter(t => t))
        } else if (g.text) {
          return acc.concat([g.text])
        } else {
          return acc
        }
      }, [])
    if (!texts || texts.length === 0) {
      // Assistant V1 legacy
      texts = sendMessageResponse.output.text && (_.isArray(sendMessageResponse.output.text) ? sendMessageResponse.output.text.filter(t => t) : [ sendMessageResponse.output.text ])
    }
    if (!texts || texts.length === 0) {
      texts = [ undefined ]
    }

    const media = generic && generic.filter(g => g.response_type === 'image')
      .map(g => ({
        mediaUri: g.source,
        altText: g.title
      }))

    const buttons = generic && generic.filter(g => g.response_type === 'option')
      .reduce((acc, g) => {
        return g.options && acc.concat(g.options.map(o => ({
          text: o.label,
          payload: o.value && o.value.input && o.value.input.text
        })))
      }, [])

    texts.forEach((messageText) => {
      const botMsg = { sender: 'bot', sourceData: sendMessageResponse, messageText, media, buttons, nlp }
      setTimeout(() => this.queueBotSays(botMsg), 0)
      forceIntentResolution = false
    })

    if (forceIntentResolution) {
      const botMsg = { sender: 'bot', sourceData: sendMessageResponse, nlp }
      setTimeout(() => this.queueBotSays(botMsg), 0)
      forceIntentResolution = false
    }
  }

  Stop () {
    debug('Stop called')
    this.sessionId = null
    this.conversationContext = null
    return Promise.resolve()
  }

  Clean () {
    debug('Clean called')
    return new Promise((resolve, reject) => {
      async.series([

        (workspaceDeleteReady) => {
          if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1') {
            if (this.caps[Capabilities.WATSON_COPY_WORKSPACE]) {
              this.assistant.deleteWorkspace({ workspace_id: this.useWorkspaceId }, (err) => {
                if (err) {
                  debug(`Watson workspace delete copy failed: ${util.inspect(err)}`)
                } else {
                  debug(`Watson workspace deleted: ${this.useWorkspaceId}`)
                }
                workspaceDeleteReady()
              })
            } else {
              workspaceDeleteReady()
            }
          } else {
            workspaceDeleteReady()
          }
        },

        (conversationReset) => {
          this.assistant = null
          this.sessionId = null
          this.conversationContext = null
          conversationReset()
        }

      ], (err) => {
        if (err) return reject(new Error(`Cleanup failed ${util.inspect(err)}`))
        resolve(this)
      })
    })
  }
}

module.exports = BotiumConnectorWatson
