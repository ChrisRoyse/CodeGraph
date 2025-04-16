// GENERATED CODE -- DO NOT EDIT!

'use strict';
var grpc = require('@grpc/grpc-js');
var id_service_pb = require('./id_service_pb.js');

function serialize_bmcp_id_service_GenerateIdRequest(arg) {
  if (!(arg instanceof id_service_pb.GenerateIdRequest)) {
    throw new Error('Expected argument of type bmcp.id_service.GenerateIdRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_bmcp_id_service_GenerateIdRequest(buffer_arg) {
  return id_service_pb.GenerateIdRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_bmcp_id_service_GenerateIdResponse(arg) {
  if (!(arg instanceof id_service_pb.GenerateIdResponse)) {
    throw new Error('Expected argument of type bmcp.id_service.GenerateIdResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_bmcp_id_service_GenerateIdResponse(buffer_arg) {
  return id_service_pb.GenerateIdResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_bmcp_id_service_ParseIdRequest(arg) {
  if (!(arg instanceof id_service_pb.ParseIdRequest)) {
    throw new Error('Expected argument of type bmcp.id_service.ParseIdRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_bmcp_id_service_ParseIdRequest(buffer_arg) {
  return id_service_pb.ParseIdRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_bmcp_id_service_ParseIdResponse(arg) {
  if (!(arg instanceof id_service_pb.ParseIdResponse)) {
    throw new Error('Expected argument of type bmcp.id_service.ParseIdResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_bmcp_id_service_ParseIdResponse(buffer_arg) {
  return id_service_pb.ParseIdResponse.deserializeBinary(new Uint8Array(buffer_arg));
}


// IdService provides centralized ID generation and parsing
var IdServiceService = exports.IdServiceService = {
  // GenerateId generates a canonical ID and GID for a given entity
generateId: {
    path: '/bmcp.id_service.IdService/GenerateId',
    requestStream: false,
    responseStream: false,
    requestType: id_service_pb.GenerateIdRequest,
    responseType: id_service_pb.GenerateIdResponse,
    requestSerialize: serialize_bmcp_id_service_GenerateIdRequest,
    requestDeserialize: deserialize_bmcp_id_service_GenerateIdRequest,
    responseSerialize: serialize_bmcp_id_service_GenerateIdResponse,
    responseDeserialize: deserialize_bmcp_id_service_GenerateIdResponse,
  },
  // ParseId parses a canonical ID or GID into its components
parseId: {
    path: '/bmcp.id_service.IdService/ParseId',
    requestStream: false,
    responseStream: false,
    requestType: id_service_pb.ParseIdRequest,
    responseType: id_service_pb.ParseIdResponse,
    requestSerialize: serialize_bmcp_id_service_ParseIdRequest,
    requestDeserialize: deserialize_bmcp_id_service_ParseIdRequest,
    responseSerialize: serialize_bmcp_id_service_ParseIdResponse,
    responseDeserialize: deserialize_bmcp_id_service_ParseIdResponse,
  },
};

exports.IdServiceClient = grpc.makeGenericClientConstructor(IdServiceService, 'IdService');
