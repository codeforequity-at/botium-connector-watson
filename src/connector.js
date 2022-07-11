const util = require('util')
const async = require('async')
const tunnel = require('tunnel')
const randomize = require('randomatic')
const _ = require('lodash')
const AssistantV1 = require('ibm-watson/assistant/v1')
const AssistantV2 = require('ibm-watson/assistant/v2')
const { IamAuthenticator, BearerTokenAuthenticator, BasicAuthenticator } = require('ibm-watson/auth')
const debug = require('debug')('botium-connector-watson')
const { getWorkspace, createWorkspace, waitWorkspaceAvailable, promiseTimeout } = require('./helpers')

const Capabilities = {
  WATSON_ASSISTANT_VERSION: 'WATSON_ASSISTANT_VERSION',
  WATSON_URL: 'WATSON_URL',
  WATSON_TIMEOUT: 'WATSON_TIMEOUT',
  WATSON_HTTP_PROXY_HOST: 'WATSON_HTTP_PROXY_HOST',
  WATSON_HTTP_PROXY_PORT: 'WATSON_HTTP_PROXY_PORT',
  WATSON_VERSION: 'WATSON_VERSION',
  WATSON_APIKEY: 'WATSON_APIKEY',
  WATSON_BEARER: 'WATSON_BEARER',
  WATSON_USER: 'WATSON_USER',
  WATSON_PASSWORD: 'WATSON_PASSWORD',
  WATSON_WORKSPACE_ID: 'WATSON_WORKSPACE_ID',
  WATSON_ASSISTANT_ID: 'WATSON_ASSISTANT_ID',
  WATSON_ASSISTANT_USER_ID: 'WATSON_ASSISTANT_USER_ID',
  WATSON_COPY_WORKSPACE: 'WATSON_COPY_WORKSPACE',
  WATSON_FORCE_INTENT_RESOLUTION: 'WATSON_FORCE_INTENT_RESOLUTION',
  WATSON_WELCOME_MESSAGE: 'WATSON_WELCOME_MESSAGE',
  WATSON_INITIAL_CONTEXT: 'WATSON_INITIAL_CONTEXT'
}

const Defaults = {
  [Capabilities.WATSON_ASSISTANT_VERSION]: 'V1',
  [Capabilities.WATSON_URL]: 'https://api.us-south.assistant.watson.cloud.ibm.com',
  [Capabilities.WATSON_TIMEOUT]: 10000,
  [Capabilities.WATSON_VERSION]: '2020-04-01',
  [Capabilities.WATSON_COPY_WORKSPACE]: false,
  [Capabilities.WATSON_FORCE_INTENT_RESOLUTION]: false
}

class BotiumConnectorWatson {
  constructor ({ queueBotSays, caps }) {
    this.queueBotSays = queueBotSays
    this.caps = caps
  }

  async Validate () {
    debug('Validate called')
    this.caps = Object.assign({}, Defaults, this.caps)

    if (!this.caps[Capabilities.WATSON_URL]) throw new Error('WATSON_URL capability required')
    if (!this.caps[Capabilities.WATSON_APIKEY] && !this.caps[Capabilities.WATSON_BEARER]) {
      if (!this.caps[Capabilities.WATSON_USER]) throw new Error('WATSON_USER capability required (or use WATSON_APIKEY or WATSON_BEARER)')
      if (!this.caps[Capabilities.WATSON_PASSWORD]) throw new Error('WATSON_PASSWORD capability required (or use WATSON_APIKEY or WATSON_BEARER)')
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

    if (this.caps[Capabilities.WATSON_INITIAL_CONTEXT]) {
      if (_.isString(this.caps[Capabilities.WATSON_INITIAL_CONTEXT])) {
        this.caps[Capabilities.WATSON_INITIAL_CONTEXT] = JSON.parse(this.caps[Capabilities.WATSON_INITIAL_CONTEXT])
      }
    }
  }

  Build () {
    debug('Build called')
    return new Promise((resolve, reject) => {
      async.series([
        (assistantReady) => {
          const addTimeout = (opts) => {
            if (this.caps[Capabilities.WATSON_TIMEOUT] && this.caps[Capabilities.WATSON_TIMEOUT] > 0) {
              opts.timeout = this.caps[Capabilities.WATSON_TIMEOUT]
            }
            return opts
          }
          const opts = addTimeout({
            url: this.caps[Capabilities.WATSON_URL],
            version: this.caps[Capabilities.WATSON_VERSION]
          })
          if (this.caps[Capabilities.WATSON_APIKEY]) {
            Object.assign(opts, { authenticator: new IamAuthenticator(addTimeout({ apikey: this.caps[Capabilities.WATSON_APIKEY] })) })
          } else if (this.caps[Capabilities.WATSON_BEARER]) {
            Object.assign(opts, { authenticator: new BearerTokenAuthenticator(addTimeout({ bearerToken: this.caps[Capabilities.WATSON_BEARER] })) })
          } else {
            Object.assign(opts, { authenticator: new BasicAuthenticator(addTimeout({
                username: this.caps[Capabilities.WATSON_USER],
                password: this.caps[Capabilities.WATSON_PASSWORD]
              }))
            })
          }

          if (this.caps[Capabilities.WATSON_HTTP_PROXY_HOST] && this.caps[Capabilities.WATSON_HTTP_PROXY_PORT]) {
            opts.disableSslVerification = true
            opts.httpsAgent = tunnel.httpsOverHttp({
              proxy: {
                host: this.caps[Capabilities.WATSON_HTTP_PROXY_HOST],
                port: this.caps[Capabilities.WATSON_HTTP_PROXY_PORT]
              }
            })
            opts.proxy = false
          }

          if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1') {
            this.assistant = new AssistantV1(opts)
            debug(`Created V1 Assistant Client with options: ${JSON.stringify(opts)}`)
          } else if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V2') {
            this.assistant = new AssistantV2(opts)
            debug(`Created V2 Assistant Client with options: ${JSON.stringify(opts)}`)
          }
          assistantReady()
        },

        (workspaceCopied) => {
          if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1') {
            if (this.caps[Capabilities.WATSON_COPY_WORKSPACE]) {
              // eslint-disable-next-line no-unexpected-multiline
              (async () => {
                try {
                  const newWorkspace = await getWorkspace(this.assistant, this.caps[Capabilities.WATSON_WORKSPACE_ID], true)
                  debug(`Watson workspace copying from: ${util.inspect(newWorkspace)}`)
                  newWorkspace.name = `${newWorkspace.name}-Botium-${randomize('Aa0', 5)}`
                  const workspaceCopy = await createWorkspace(this.assistant, newWorkspace)
                  debug(`Watson workspace copied: ${util.inspect(workspaceCopy)}`)
                  this.useWorkspaceId = workspaceCopy.workspace_id
                  workspaceCopied()
                } catch (err) {
                  workspaceCopied(err)
                }
              })()
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
            // eslint-disable-next-line no-unexpected-multiline
            (async () => {
              try {
                await waitWorkspaceAvailable(this.assistant, this.useWorkspaceId)
                workspaceAvailableReady()
              } catch (err) {
                workspaceAvailableReady(err)
              }
            })()
          } else {
            workspaceAvailableReady()
          }
        }

      ], (err) => {
        if (err) {
          return reject(new Error(`Cannot build watson container: ${err.message}`))
        }
        resolve(this)
      })
    })
  }

  async Start () {
    debug('Start called')
    this.conversationContext = {}

    if (this.caps[Capabilities.WATSON_INITIAL_CONTEXT]) {
      if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1') {
        this.conversationContext = _.cloneDeep(this.caps[Capabilities.WATSON_INITIAL_CONTEXT])
      } else if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V2') {
        this.conversationContext = {
          skills: {
            'main skill': {
              user_defined: _.cloneDeep(this.caps[Capabilities.WATSON_INITIAL_CONTEXT])
            }
          }
        }
      }
    }
    if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V2') {
      try {
        const createSessionResponse = await promiseTimeout(this.assistant.createSession({ assistantId: this.caps[Capabilities.WATSON_ASSISTANT_ID] }), this.caps[Capabilities.WATSON_TIMEOUT])
        this.sessionId = createSessionResponse.result.session_id
        debug(`Created Watson session ${this.sessionId}`)
      } catch (err) {
        throw new Error(`Failed to create Watson session: ${err.message}`)
      }
    }
    if (!_.isNil(this.caps[Capabilities.WATSON_WELCOME_MESSAGE])) {
      await this.UserSays({ messageText: this.caps[Capabilities.WATSON_WELCOME_MESSAGE] })
    }
  }

  async UserSays (msg) {
    debug('UserSays called')
    if (!this.assistant) throw new Error('not built')

    this.conversationContext = this.conversationContext || {}

    const getInputPayload = () => {
      if (msg.SET_WATSON_CONTEXT) {
        _.keys(msg.SET_WATSON_CONTEXT).forEach(key => {
          _.set(this.conversationContext, key, msg.SET_WATSON_CONTEXT[key])
        })
      }
      if (msg.UNSET_WATSON_CONTEXT) {
        const keys = _.isString(msg.UNSET_WATSON_CONTEXT) ? [msg.UNSET_WATSON_CONTEXT] : msg.UNSET_WATSON_CONTEXT

        keys.forEach(key => {
          _.set(this.conversationContext, key, null)
        })
      }

      if (this.caps[Capabilities.WATSON_ASSISTANT_USER_ID]) {
        if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1') {
          _.set(this.conversationContext, 'metadata.user_id', `${this.caps[Capabilities.WATSON_ASSISTANT_USER_ID]}`)
        } else if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V2') {
          _.set(this.conversationContext, 'global.system.user_id', `${this.caps[Capabilities.WATSON_ASSISTANT_USER_ID]}`)
        }
      }

      if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1') {
        return {
          workspaceId: this.useWorkspaceId,
          context: this.conversationContext || {},
          input: { text: msg.messageText },
          alternateIntents: true
        }
      } else if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V2') {
        return {
          assistantId: this.caps[Capabilities.WATSON_ASSISTANT_ID],
          sessionId: this.sessionId,
          input: {
            message_type: 'text',
            text: msg.messageText,
            options: {
              alternate_intents: true,
              debug: debug.enabled,
              return_context: true
            }
          },
          context: this.conversationContext || {}
        }
      }
    }
    const handleResponse = async (sendMessageResponse) => {
      if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V1') {
        this.conversationContext = sendMessageResponse.result.context
        await this._processWatsonResponse(sendMessageResponse.result,
          sendMessageResponse.result.output.generic,
          sendMessageResponse.result.output.action ? [sendMessageResponse.result.output.action] : (sendMessageResponse.result.actions || []),
          sendMessageResponse.result.intents,
          sendMessageResponse.result.entities)
      } else if (this.caps[Capabilities.WATSON_ASSISTANT_VERSION] === 'V2') {
        this.conversationContext = { skills: sendMessageResponse.result.context.skills }
        await this._processWatsonResponse(sendMessageResponse.result,
          sendMessageResponse.result.output.generic,
          sendMessageResponse.result.output.actions || null,
          sendMessageResponse.result.output.intents,
          sendMessageResponse.result.output.entities)
      }
    }

    let sendMessageResponse = {}
    try {
      const inputPayload = getInputPayload()
      msg.sourceData = inputPayload
      debug(`Watson request: ${JSON.stringify(inputPayload, null, 2)}`)
      sendMessageResponse = await promiseTimeout(this.assistant.message(inputPayload), this.caps[Capabilities.WATSON_TIMEOUT])
      debug(`Watson response: ${JSON.stringify(sendMessageResponse, null, 2)}`)
    } catch (err) {
      throw new Error(`Cannot send message to watson container: ${err.message}`)
    }
    await handleResponse(sendMessageResponse)
  }

  async _processWatsonResponse (sendMessageResponse, generic, actions, intents, entities) {
    const nlp = {
      intent: {},
      entities: []
    }

    if (intents && intents.length > 0) {
      nlp.intent = {
        name: intents[0].intent,
        confidence: intents[0].confidence,
        intents: []
      }
      if (intents.length > 1) {
        nlp.intent.intents = intents.slice(1).map((intent) => { return { name: intent.intent, confidence: intent.confidence } })
      }
    }
    if (entities && entities.length > 0) {
      nlp.entities = entities.map((entity) => { return { name: entity.entity, value: entity.value, confidence: entity.confidence } })
    }
    let forceIntentResolution = this.caps[Capabilities.WATSON_FORCE_INTENT_RESOLUTION]

    const sendBotMsg = (botMsg) => {
      setTimeout(() => this.queueBotSays(Object.assign({}, { sender: 'bot', sourceData: sendMessageResponse, nlp }, botMsg)), 0)
      forceIntentResolution = false
    }

    if (generic && generic.length > 0) {
      for (const response of generic) {
        if (response.response_type === 'text') {
          const messageText = _.isArray(response.text) ? response.text.join('\r\n') : response.text
          sendBotMsg({ messageText })
        } else if (response.response_type === 'image') {
          sendBotMsg({
            media: [
              {
                mediaUri: response.source,
                altText: response.title
              }
            ]
          })
        } else if (response.response_type === 'option') {
          const messageText = response.title
          const buttons = response.options.map(o => ({
            text: o.label,
            payload: o.value && o.value.input && o.value.input.text
          }))
          sendBotMsg({ messageText, buttons })
        } else if (response.response_type === 'suggestion') {
          const messageText = response.title
          const buttons = response.suggestions.map(o => ({
            text: o.label,
            payload: o.value && o.value.input && o.value.input.text
          }))
          sendBotMsg({ messageText, buttons })
        } else {
          debug(`Response type ${response.response_type} not supported.`)
        }
      }
    } else if (actions && actions.length > 0) {
      sendBotMsg({ })
    } else if (sendMessageResponse.output.text) {
      // Assistant V1 legacy
      const messageText = _.isArray(sendMessageResponse.output.text) ? sendMessageResponse.output.text.join('\r\n') : sendMessageResponse.output.text
      sendBotMsg({ messageText })
    }

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
              this.assistant.deleteWorkspace({ workspaceId: this.useWorkspaceId }, (err) => {
                if (err) {
                  debug(`Watson workspace delete copy failed: ${err.message}`)
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
        if (err) return reject(new Error(`Cleanup failed: ${err.message}`))
        resolve(this)
      })
    })
  }
}

module.exports = BotiumConnectorWatson
