# Botium Connector for IBM Watson Assistant

[![NPM](https://nodei.co/npm/botium-connector-watson.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/botium-connector-watson/)

[ ![Codeship Status for codeforequity-at/botium-connector-watson](https://app.codeship.com/projects/6075bd10-b02e-0136-4bcc-2eae8ef75d66/status?branch=master)](https://app.codeship.com/projects/310383)
[![npm version](https://badge.fury.io/js/botium-connector-watson.svg)](https://badge.fury.io/js/botium-connector-watson)
[![license](https://img.shields.io/github/license/mashape/apistatus.svg)]()


## Capabilities for operation mode "watson"

### WATSON_URL
_Default: "https://gateway.watsonplatform.net/assistant/api"_

### WATSON_VERSION
_Default: "2018-09-20"_

### WATSON_APIKEY *
IAM API Key for IBM Watson - see [here](https://cloud.ibm.com/docs/services/watson/getting-started-iam.html) how to create it for your IBM Watson account. Either the IAM API Key or the Service credentials (see below) are required.

### WATSON_USER * and WATSON_PASSWORD *
Service credentials for your IBM Watson instance - see [here](https://console.bluemix.net/docs/services/watson/getting-started-credentials.html#service-credentials-for-watson-services) how to create them for your IBM Watson account.

### WATSON_WORKSPACE_ID *
The Workspace ID to use. You can find it in the IBM Watson Assistant Dashboard when clicking on "View Details" in the popup menu of a workspace.

### WATSON_USE_INTENT
_Default: false_
If this capability is enabled, Botium will use the resolved intent as text output instead of the actual text output from IBM Watson.

### WATSON_COPY_WORKSPACE
_Default: false_

This capability will copy the Watson workspace and run the Botium script on the new workspace (and delete it afterwards). Typically, when running a large amount of tests on production conversation service, the Watson workspace should not get "polluted" with test data - enabling this capability will prevent that. 
_Attention: as the copied workspace will run through Watson training session, it could take some time until the copied workspace is available. Botium will only continue after training is complete_
