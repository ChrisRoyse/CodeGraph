// GENERATED CODE -- DO NOT EDIT!

'use strict';
var grpc = require('@grpc/grpc-js');
var analyzer_service_pb = require('./analyzer_service_pb.js');

function serialize_bmcp_analyzer_service_AnalyzeRequest(arg) {
  if (!(arg instanceof analyzer_service_pb.AnalyzeRequest)) {
    throw new Error('Expected argument of type bmcp.analyzer_service.AnalyzeRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_bmcp_analyzer_service_AnalyzeRequest(buffer_arg) {
  return analyzer_service_pb.AnalyzeRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_bmcp_analyzer_service_AnalyzeResponse(arg) {
  if (!(arg instanceof analyzer_service_pb.AnalyzeResponse)) {
    throw new Error('Expected argument of type bmcp.analyzer_service.AnalyzeResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_bmcp_analyzer_service_AnalyzeResponse(buffer_arg) {
  return analyzer_service_pb.AnalyzeResponse.deserializeBinary(new Uint8Array(buffer_arg));
}


// AnalyzerService provides language-specific code analysis
var AnalyzerServiceService = exports.AnalyzerServiceService = {
  // Analyze performs analysis on a file and returns the results
analyze: {
    path: '/bmcp.analyzer_service.AnalyzerService/Analyze',
    requestStream: false,
    responseStream: false,
    requestType: analyzer_service_pb.AnalyzeRequest,
    responseType: analyzer_service_pb.AnalyzeResponse,
    requestSerialize: serialize_bmcp_analyzer_service_AnalyzeRequest,
    requestDeserialize: deserialize_bmcp_analyzer_service_AnalyzeRequest,
    responseSerialize: serialize_bmcp_analyzer_service_AnalyzeResponse,
    responseDeserialize: deserialize_bmcp_analyzer_service_AnalyzeResponse,
  },
};

exports.AnalyzerServiceClient = grpc.makeGenericClientConstructor(AnalyzerServiceService, 'AnalyzerService');
