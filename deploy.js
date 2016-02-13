var inquirer = require('inquirer'),
  AWS = require('aws-sdk'),
  fs = require('fs'),
  path = require('path'),
  //ProxyAgent = require('proxy-agent'),
  //proxyUri = process.env.http_proxy || 'http://mentionproxy:port',
  cloudformation,
  envArg = process.argv[2] || '';
JSON.minify = JSON.minify || require("node-json-minify");
AWS.config.update({region: 'us-west-2'});

//console.log('using proxy: ', proxyUri);
//AWS.config.update({ httpOptions: { agent: new ProxyAgent(proxyUri) } });

// this has to be done AFTER proxy is set
cloudformation = new AWS.CloudFormation({apiVersion: '2010-09-09'});

if (envArg.indexOf('.json') === -1) {
  envArg = envArg + '.json';
}

fs.readdir('envs', function(err, files) {
  if (err) {
    console.log('error reading environment files');
    throw err;
  }

  if (files.indexOf(envArg) > -1) {
    runCFT(envArg);
    return;
  }

  inquirer.prompt({
    type: 'list',
    name: 'env',
    message: 'Choose environment:',
    choices: files
  }, function(answer) {
    runCFT(answer.env);
  });
});



function runCFT(envFile) {
  console.log('running cft for environment: ', envFile);

  fs.readFile(path.join('envs', envFile), 'utf8', function (err, data) {
    var cftVariables;
    if (err) {
      console.log('error reading variables file');
      throw err;
    }
    try {
      cftVariables = JSON.parse(data);
    } catch(e) {
      console.log('error parsing variables file');
      throw e;
    }

    queryStack(cftVariables, function(exists) {
      if (exists) {
        updateStack(cftVariables);
      } else {
        createStack(cftVariables);
      }
    });
  });

}

function queryStack(options, callback) {
  var search = {};
  if (options.stack_name) {
    search.StackName = options.stack_name;
  } else if (options.stack_id) {
    search.StackName = options.stack_id;
  } else {
    throw new Error('Unknown stack information to search for');
  }

  cloudformation.describeStacks(search, function(err, data) {
    if (err) {
      if (err.message.indexOf('does not exist') > -1) {
        callback(false);
      } else {
        throw err;
      }
    } else {
      // console.log(data);
      callback(true, data);
    }
  });
}

function validateTemplate(cftParams, callback) {
  console.log('validating template');
  cloudformation.validateTemplate({TemplateBody: cftParams.TemplateBody}, function(err, data) {
    if (err) {
      console.log('error validating template');
      throw err;
    } else {
      callback(err, data);
    }
  });
}

function buildParameters(options) {
  console.log('Using the CFT file : ', options.cft_file);
  var minifiedtemplate = JSON.parse(JSON.minify(fs.readFileSync(options.cft_file, 'utf8')));
  var params = {
    StackName: options.stack_name,
    OnFailure: 'DO_NOTHING',
    Parameters: [],
    Tags: [],
    TemplateBody: JSON.stringify(minifiedtemplate),
    Capabilities: ['CAPABILITY_IAM']
  };

  Object.keys(options.tags).forEach(function(key) {
    params.Tags.push({
      Key: key,
      Value: options.tags[key]
    });
  });

  Object.keys(options.parameters).forEach(function(key) {
    params.Parameters.push({
      ParameterKey: key,
      ParameterValue: options.parameters[key],
      UsePreviousValue: false
    });
  });

  return params;
}


function createStack(options) {
  var cftParams = buildParameters(options);

  validateTemplate(cftParams, function(err, data) {
    console.log('Template validated, starting');
    cloudformation.createStack(cftParams, function(err, data) {
      if (err) {
        console.log('error creating stack');
        console.log(err, err.stack); // an error occurred
        throw err;
      } else {
        console.log('request succeeded');
        // console.log(data); // successful response
        // { ResponseMetadata: { RequestId: '3521f50c-3b92-11e5-b4b9-372a9fe69b90' },
        // StackId: 'arn:aws:cloudformation:us-west-2:500238854089:stack/shop-node-api-a-dev-anuj/356da3f0-3b92-11e5-a309-50d50205787c' }
        monitorStack(data.StackId, function(result) {
          console.log(result);
        });
      }
    });
  });
}

function updateStack(options) {
  var cftParams = buildParameters(options);

  delete cftParams.OnFailure;
  delete cftParams.Tags;

  validateTemplate(cftParams, function(err, data) {
    console.log('Template validated, starting');
    cloudformation.updateStack(cftParams, function(err, data) {
      if (err) {
        console.log('error creating stack');
        console.log(err, err.stack); // an error occurred
        throw err;
      } else {
        console.log('request succeeded');
        // console.log(data); // successful response
        // { ResponseMetadata: { RequestId: '3521f50c-3b92-11e5-b4b9-372a9fe69b90' },
        // StackId: 'arn:aws:cloudformation:us-west-2:500238854089:stack/shop-node-api-a-dev-anuj/356da3f0-3b92-11e5-a309-50d50205787c' }
        monitorStack(data.StackId, function(result) {
          console.log(result);
        });
      }
    });
  });

}

function monitorStack(stackId, endOnStatuses, callback) {
  var monitorInterval,
    checkEverySeconds = 30,
    statusCheckFailTimeout = (new Date()).getTime() + (60 * 60 * 1000), // 60 minutes
    endOnStatuses = [
      'CREATE_COMPLETE',
      'UPDATE_COMPLETE',
      'DELETE_COMPLETE',
      'CREATE_FAILED',
      'UPDATE_FAILED',
      'DELETE_FAILED',
      'DELETE_SKIPPED',
      'ROLLBACK_COMPLETE',
      'ROLLBACK_FAILED',
      'UPDATE_ROLLBACK_COMPLETE',
      'UPDATE_ROLLBACK_FAILED'
    ];

  console.log('starting monitoring. will check every ' + checkEverySeconds + ' seconds.');

  monitorInterval = setInterval(function() {
    if ((new Date()).getTime() > statusCheckFailTimeout) {
      console.log('timeout reached. no longer checking status of stack');
      clearInterval(monitorInterval);
      process.exit(1);
      return;
    }
    queryStack({stack_id: stackId}, function(exists, data) {
      var status = 'unknown',
        stackName = 'unknown';
      if (data.Stacks && data.Stacks.length === 1) {
        // check to see the status of the stack
        // console.log(data.Stacks[0]);
        status = data.Stacks[0].StackStatus;
        stackName = data.Stacks[0].StackName;

        if (endOnStatuses.indexOf(status) > -1) {
          // stack is done processing, whatever that result is
          console.log('Stack "' + stackName + '"is done. Last status: ', status);
          clearInterval(monitorInterval);
        } else {
          console.log('Status of "' + stackName + '": ', status);
        }

      } else {
        // no stack data returned
        console.log('no stack information available');
        clearInterval(monitorInterval);
      }
    });

  }, checkEverySeconds * 1000);

}
