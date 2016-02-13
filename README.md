# AWS-SA-POC-INFRASTRUCTURE
This repo has the sample code for the infrastructure stack.

## USAGE ##

Deployment of the cloudformation template is through deploy.js, which eliminates the need of logging in the AWS console.

* Install node.js
* Run npm install, which will download all the necessary packge
* All the .js files inside /envs folder is a specific cloudformation file. The .js files includes the parameters, which are passed to the template. This seperates static variables and dynamic variables and easier maintainance of variables between various CI environments.
* The /env/{envfile} also includes the base template that will run.You can now logically seperate various base templates.

* Run node deploy {envfile} to create or update the stack
