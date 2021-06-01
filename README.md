[![DOI](https://zenodo.org/badge/372452007.svg)](https://zenodo.org/badge/latestdoi/372452007)

# Pulumi TypeScript Stack References to µs Converter

This program converts stack references in Pulumi TypeScript projects to µs remotes and wishes, and stack outputs to µs offers.

## Usage

You can use this program with a local Node.js setup or within an interactive shell session of a Node.js docker container, which you can start in this directory:

```
docker run --rm -ti -v $(pwd):/var/converter node:16.2.0-alpine3.13 /bin/sh /var/converter/init-container.sh
```

The container is automatically disposed when you exit the shell.

### Install Dependencies

```
npm install
```

### Run the Converter

```
node translate.js
```

This executes the conversion on all files in `./repos`. Please note that the conversion is not idempotent and, thus, should only be executed once.

## Example

To give an example, we provide the aws-ts-stackreference project from the [Pulumi examples](https://github.com/pulumi/examples) in `./repos/example`. Running the converter once, converts all three included programs. For instance, `./repos/example/team/index.ts` gets converted to the following content:

```
// Copyright 2016-2019, Pulumi Corporation.  All rights reserved.

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as mjuz from '@mjuz/core/resources'

/**
 *   company
 *   └─ department
 *      └─ team
 */

const config = new pulumi.Config();

const companyStack = new mjuz.Remote<{ companyName: any }>(config.require("companyStack"),
            { host: config.require('companyStackHost'), port: config.require('companyStackPort') });
const departmentStack = new mjuz.Remote<{ departmentName: any }>(config.require("departmentStack"),
            { host: config.require('departmentStackHost'), port: config.require('departmentStackPort') });

const combinedTags = {
    /* from company stack    */ company: companyStack.wishes.exports.companyName,
    /* from department stack */ department: departmentStack.wishes.exports.departmentName,
    /* from team config      */ team: config.require("teamName"),
    "Managed By": "Pulumi",
};

const amiId = aws.getAmi({
    owners: ["099720109477"], // Ubuntu
    mostRecent: true,
    filters: [
        { name: "name", values: ["ubuntu/images/hvm-ssd/ubuntu-bionic-18.04-amd64-server-*"] },
    ],
}, { async: true }).then(ami => ami.id);

const instance = new aws.ec2.Instance("tagged", {
    ami: amiId,
    instanceType: "t2.medium",
    tags: combinedTags,
});

export const instanceId = instance.id;
export const instanceTags = instance.tags;

new mjuz.Offer(
    new mjuz.RemoteConnection('beneficiary', { host: config.require('beneficiaryHost'), port: config.require('beneficiaryPort') }), 
    'exports', { instanceId, instanceTags })
```
