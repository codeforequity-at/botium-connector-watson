const util = require('util')
const async = require('async')
const _ = require('lodash')
const AssistantV1 = require('watson-developer-cloud/assistant/v1')
const debug = require('debug')('botium-connector-watson')

const Capabilities = {
  WATSON_URL: 'WATSON_URL',
  WATSON_VERSION: 'WATSON_VERSION',
  WATSON_USER: 'WATSON_USER',
  WATSON_PASSWORD: 'WATSON_PASSWORD',
  WATSON_WORKSPACE_ID: 'WATSON_WORKSPACE_ID',
  WATSON_COPY_WORKSPACE: 'WATSON_COPY_WORKSPACE',
  WATSON_USE_INTENT: 'WATSON_USE_INTENT'
}

const Defaults = {
  [Capabilities.WATSON_URL]: 'https://gateway.watsonplatform.net/assistant/api',
  [Capabilities.WATSON_VERSION]: '2018-09-20',
  [Capabilities.WATSON_COPY_WORKSPACE]: false,
  [Capabilities.WATSON_USE_INTENT]: false
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
    if (!this.caps[Capabilities.WATSON_USER]) throw new Error('WATSON_USER capability required')
    if (!this.caps[Capabilities.WATSON_PASSWORD]) throw new Error('WATSON_PASSWORD capability required')
    if (!this.caps[Capabilities.WATSON_WORKSPACE_ID]) throw new Error('WATSON_WORKSPACE_ID capability required')
    if (!this.caps[Capabilities.WATSON_VERSION]) throw new Error('WATSON_VERSION capability required')

    return Promise.resolve()
  }

  Build () {
    debug('Build called')
    return new Promise((resolve, reject) => {
      async.series([
        (assistantReady) => {
          this.assistant = new AssistantV1({
            url: this.caps[Capabilities.WATSON_URL],
            username: this.caps[Capabilities.WATSON_USER],
            password: this.caps[Capabilities.WATSON_PASSWORD],
            version: this.caps[Capabilities.WATSON_VERSION]
          })
          assistantReady()
        },

        (workspaceCopied) => {
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
        },

        (workspaceAvailableReady) => {
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
        }

      ], (err) => {
        if (err) {
          return reject(new Error(`Cannot build watson container: ${util.inspect(err)}`))
        }
        resolve(this)
      })
    })
  }

  Start () {
    debug('Start called')
    this.conversationContext = {}
    return Promise.resolve()
  }

  UserSays (msg) {
    debug('UserSays called')
    if (!this.assistant) return Promise.reject(new Error('not built'))

    return new Promise((resolve, reject) => {
      const payload = {
        workspace_id: this.useWorkspaceId,
        context: this.conversationContext || {},
        input: { text: msg.messageText }
      }
      if (this.caps[Capabilities.WATSON_USE_INTENT]) {
        payload.alternate_intents = true
      }
      this.assistant.message(payload, (err, data) => {
        if (err) return reject(new Error(`Cannot send message to watson container: ${util.inspect(err)}`))

        debug(`Watson response: ${util.inspect(data)}`)
        this.conversationContext = data.context

        if (this.caps[Capabilities.WATSON_USE_INTENT]) {
          if (data.intents.length > 1 && data.intents[0].confidence === data.intents[1].confidence) {
            return reject(new Error(`Got duplicate intent confidence ${util.inspect(data.intents[0])} vs ${util.inspect(data.intents[1])}`))
          }
        }
        resolve(this)

        if (this.caps[Capabilities.WATSON_USE_INTENT]) {
          if (data.intents && data.intents.length > 0) {
            const botMsg = { sender: 'bot', sourceData: data, messageText: data.intents[0].intent }
            setTimeout(() => this.queueBotSays(botMsg), 0)
          }
        } else {
          if (data.output && data.output.text) {
            const messageTexts = (_.isArray(data.output.text) ? data.output.text : [ data.output.text ])

            messageTexts.forEach((messageText) => {
              if (!messageText) return

              const botMsg = { sender: 'bot', sourceData: data, messageText }
              setTimeout(() => this.queueBotSays(botMsg), 0)
            })
          }
        }
      })
    })
  }

  Stop () {
    debug('Stop called')
    return Promise.resolve()
  }

  Clean () {
    debug('Clean called')
    return new Promise((resolve, reject) => {
      async.series([

        (workspaceDeleteReady) => {
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
        },

        (conversationReset) => {
          this.assistant = null
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

module.exports = {
  PluginVersion: 1,
  PluginClass: BotiumConnectorWatson
}
