import "sst/node/config";
declare module "sst/node/config" {
  export interface ConfigTypes {
    APP: string;
    STAGE: string;
  }
}

import "sst/node/table";
declare module "sst/node/table" {
  export interface TableResources {
    "Messages": {
      tableName: string;
    }
  }
}

import "sst/node/bucket";
declare module "sst/node/bucket" {
  export interface BucketResources {
    "Emails": {
      bucketName: string;
    }
  }
}

import "sst/node/function";
declare module "sst/node/function" {
  export interface FunctionResources {
    "Receive": {
      functionName: string;
    }
  }
}

import "sst/node/api";
declare module "sst/node/api" {
  export interface ApiResources {
    "Api": {
      url: string;
    }
  }
}

