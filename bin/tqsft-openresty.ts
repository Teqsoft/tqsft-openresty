#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TqsftOpenrestyStack } from '../lib/tqsft-openresty-stack';

const app = new cdk.App();
new TqsftOpenrestyStack(app, 'TqsftOpenrestyStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});