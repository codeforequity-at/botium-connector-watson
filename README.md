# Botium Connector for IBM Watson Assistant

[![NPM](https://nodei.co/npm/botium-connector-watson.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/botium-connector-watson/)

[ ![Codeship Status for codeforequity-at/botium-connector-watson](https://app.codeship.com/projects/6075bd10-b02e-0136-4bcc-2eae8ef75d66/status?branch=master)](https://app.codeship.com/projects/310383)
[![npm version](https://badge.fury.io/js/botium-connector-watson.svg)](https://badge.fury.io/js/botium-connector-watson)
[![license](https://img.shields.io/github/license/mashape/apistatus.svg)]()

This is a [Botium](https://github.com/codeforequity-at/botium-core) connector for testing your IBM Watson Assistant chatbots.

__Did you read the [Botium in a Nutshell](https://medium.com/@floriantreml/botium-in-a-nutshell-part-1-overview-f8d0ceaf8fb4) articles ? Be warned, without prior knowledge of Botium you won't be able to properly use this library!__

## How it works ?
Botium uses the IBM Watson Assistant API to run conversations.

It can be used as any other Botium connector with all Botium Stack components:
* [Botium CLI](https://github.com/codeforequity-at/botium-cli/)
* [Botium Bindings](https://github.com/codeforequity-at/botium-bindings/)
* [Botium Box](https://www.botium.ai)

This connector processes info about NLP. So Intent/Entity asserters can be used.

## Requirements

* __Node.js and NPM__
* a __IBM Watson Assistant__ chatbot, and user account with administrative rights
* a __project directory__ on your workstation to hold test cases and Botium configuration

## Install Botium and Watson Connector

When using __Botium CLI__:

```
> npm install -g botium-cli
> npm install -g botium-connector-watson
> botium-cli init
> botium-cli run
```

When using __Botium Bindings__:

```
> npm install -g botium-bindings
> npm install -g botium-connector-watson
> botium-bindings init mocha
> npm install && npm run mocha
```

When using __Botium Box__:

_Already integrated into Botium Box, no setup required_

## Connecting IBM Watson Assistant to Botium
You need IBM Cloud credentials (Username/Password or API Key) - see [IBM Docs](https://cloud.ibm.com/apidocs/assistant/assistant-v2?code=node#authentication) on how to get it.

Open the file _botium.json_ in your working directory and add the secret:

```
{
  "botium": {
    "Capabilities": {
      "PROJECTNAME": "<whatever>",
      "CONTAINERMODE": "watson",
      "WATSON_WORKSPACE_ID": "<watson workspace id>",
      "WATSON_APIKEY": "<ibm cloud api key>"
    }
  }
}
```

To check the configuration, run the emulator (Botium CLI required) to bring up a chat interface in your terminal window:

```
> botium-cli emulator
```

Botium setup is ready, you can begin to write your [BotiumScript](https://botium-docs.readthedocs.io/en/latest/05_botiumscript/index.html) files.

## Using the botium-connector-watson-cli

This connector provides a CLI interface for importing convos and utterances from your Watson workspace and convert it to BotiumScript.

* Intents and user examples are converted to BotiumScript utterances and convo files (using the _import_ command and the _--buildconvos_ or _--buildentities_ option)
* Entities and synonyms are converted to BotiumScript utterances and convo files (using the _import_ command and the _--buildentities_ option)
* User Conversations are downloaded and converted to BotiumScript convos or just a plain list for analytics (using the _importlogs_ command)

You can either run the CLI with botium-cli (it is integrated there), or directly from this connector (see samples/convoV1/package.json for some examples):

    > botium-connector-watson-cli import
    > botium-connector-watson-cli importlogs --watsonformat convo
    > botium-connector-watson-cli importlogs --watsonformat intent

_Please note that a botium-core installation is required_

For getting help on the available CLI options and switches, run:

    > botium-connector-watson-cli import --help
    > botium-connector-watson-cli importlogs --help

## Watson Assistant Context Handling

When using BotiumScript, you can do assertions on and manipulation of the Watson Assistant context variables.

### Asserting context variables

For asserting context variables, you can use the [JSON_PATH asserter](https://botium-docs.readthedocs.io/en/latest/05_botiumscript/index.html#jsonpath-asserter):

    #bot
    JSON_PATH $.context.skills['main skill'].user_defined.lightonoff|off

_Depending on your Watson Assistant skill structure, this may different - but by default, this should work_

### Adding context variables

For adding a context variable, you have to use the [UPDATE_CUSTOM logic hook](https://botium-docs.readthedocs.io/en/latest/05_botiumscript/index.html#update-custom). This example will set two context variables, one to a plain string, the other one to a JSON object:

    #me
    play some jazz music
    UPDATE_CUSTOM SET_WATSON_CONTEXT|skills['main skill'].user_defined.mycontext1|botium
    UPDATE_CUSTOM SET_WATSON_CONTEXT|skills['main skill'].user_defined.mycontext2|{"nested": "botium"}

The parameters are:
1. SET_WATSON_CONTEXT
2. The path to the context variable
3. The value of the context variable

### Removing context variables

For removing a context variable, the same logic hook is used:

    #me
    play some jazz music
    UPDATE_CUSTOM UNSET_WATSON_CONTEXT|skills['main skill'].user_defined.mycontext1
    UPDATE_CUSTOM UNSET_WATSON_CONTEXT|skills['main skill'].user_defined.mycontext2

The parameters are:
1. UNSET_WATSON_CONTEXT
2. The path to the context variable

## Usage behind a corporate proxy

In case you have an HTTPS proxy, set the _HTTPS_PROXY_ environment variable

    > HTTPS_PROXY=my-proxy-address:port npm test

If you have an HTTP proxy, Botium has to tunnel the HTTPS traffic to Watson Assistant services over HTTP. Set the _WATSON_HTTP_PROXY_HOST_ and _WATSON_HTTP_PROXY_PORT_ capabilities in botium.json (see below).

## Supported Capabilities

Set the capability __CONTAINERMODE__ to __watson__ to activate this connector.

### WATSON_ASSISTANT_VERSION
_Default: V1_

Watson supports two Assistant SDK versions, V1 and V2.
* With **V1**, Botium accesses a workspace (or _Skill_) directly
* With **V2**, Botium accesses an assistant wrapping a versioned skill

### WATSON_URL
_Default: "https://api.us-south.assistant.watson.cloud.ibm.com"_

Has to be set to the URL shown in the Skill API details page (e.g. https://api.us-east.assistant.watson.cloud.ibm.com) - for a list of valid IBM Cloud URLs see [IBM Docs](https://cloud.ibm.com/apidocs/assistant/assistant-v2?code=node#service-endpoint).

### WATSON_HTTP_PROXY_HOST / WATSON_HTTP_PROXY_PORT
Hostname/IP Address and port of your HTTP proxy

**This is only required if you have a HTTP proxy only. For HTTPS proxies, you can use the HTTPS_PROXY environment variable**

### WATSON_VERSION
_Default: "2018-09-20"_

### WATSON_APIKEY *
IAM API Key for IBM Watson - see [IBM Docs](https://cloud.ibm.com/apidocs/assistant/assistant-v2?code=node#authentication) how to create it for your IBM Watson account. Either the IAM API Key or the Service credentials (see below) are required.

### WATSON_BEARER *

IBM Watson instances using the [Cloud Pak For Data Platform](https://cloud.ibm.com/apidocs/cloud-pak-data#getauthorizationtoken) do not have IAM API Keys, but can instead be authenticated using the bearer token found within the service instance details.

### WATSON_USER * and WATSON_PASSWORD *
Service credentials for your IBM Watson instance - see [here](https://console.bluemix.net/docs/services/watson/getting-started-credentials.html#service-credentials-for-watson-services) how to create them for your IBM Watson account.

### WATSON_WORKSPACE_ID *
The Skill ID to use (Workspace ID). You can find it in the IBM Watson Assistant Dashboard when clicking on "View API Details" in the popup menu of a skill in the Skills overview list.

_This is only supported for Assistant SDK V1_

### WATSON_ASSISTANT_ID *
The Assistant ID to use. You can find it in the IBM Watson Assistant Dashboard when clicking on "Settings" in the popup menu of an assistant in the Assistants overview list.

_This is only supported for Assistant SDK V2_

### WATSON_FORCE_INTENT_RESOLUTION
_Default: false_
If this capability is disabled, then a response will be dropped if the connector does not recognizes any component like text or button in it. But the dropped message has NLP recognition info like intent and entities, which could be checked.

### WATSON_COPY_WORKSPACE
_Default: false_

This capability will copy the Watson workspace and run the Botium script on the new workspace (and delete it afterwards). Typically, when running a large amount of tests on production conversation service, the Watson workspace should not get "polluted" with test data - enabling this capability will prevent that. 

_This is only supported for Assistant SDK V1_

_Attention: as the copied workspace will run through Watson training session, it could take some time until the copied workspace is available. Botium will only continue after training is complete_

### WATSON_WELCOME_MESSAGE
_default: empty_

Trigger a welcome message from IBM Watson by sending some input upfront (for example "WELCOME")

### WATSON_ASSISTANT_USER_ID
For user-based Watson Assistant plans, it is possible to set the user-id

