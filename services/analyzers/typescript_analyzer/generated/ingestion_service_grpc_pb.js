// GENERATED CODE -- DO NOT EDIT!

'use strict';
var grpc = require('@grpc/grpc-js');
var ingestion_service_pb = require('./ingestion_service_pb.js');

function serialize_bmcp_ingestion_service_IngestResultsRequest(arg) {
  if (!(arg instanceof ingestion_service_pb.IngestResultsRequest)) {
    throw new Error('Expected argument of type bmcp.ingestion_service.IngestResultsRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_bmcp_ingestion_service_IngestResultsRequest(buffer_arg) {
  return ingestion_service_pb.IngestResultsRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_bmcp_ingestion_service_IngestResultsResponse(arg) {
  if (!(arg instanceof ingestion_service_pb.IngestResultsResponse)) {
    throw new Error('Expected argument of type bmcp.ingestion_service.IngestResultsResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_bmcp_ingestion_service_IngestResultsResponse(buffer_arg) {
  return ingestion_service_pb.IngestResultsResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_bmcp_ingestion_service_ResolvePendingRelationshipsRequest(arg) {
  if (!(arg instanceof ingestion_service_pb.ResolvePendingRelationshipsRequest)) {
    throw new Error('Expected argument of type bmcp.ingestion_service.ResolvePendingRelationshipsRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_bmcp_ingestion_service_ResolvePendingRelationshipsRequest(buffer_arg) {
  return ingestion_service_pb.ResolvePendingRelationshipsRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_bmcp_ingestion_service_ResolvePendingRelationshipsResponse(arg) {
  if (!(arg instanceof ingestion_service_pb.ResolvePendingRelationshipsResponse)) {
    throw new Error('Expected argument of type bmcp.ingestion_service.ResolvePendingRelationshipsResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_bmcp_ingestion_service_ResolvePendingRelationshipsResponse(buffer_arg) {
  return ingestion_service_pb.ResolvePendingRelationshipsResponse.deserializeBinary(new Uint8Array(buffer_arg));
}


// IngestionService handles ingestion of analysis results into the Neo4j database
var IngestionServiceService = exports.IngestionServiceService = {
  // IngestResults ingests analysis results into the Neo4j database
ingestResults: {
    path: '/bmcp.ingestion_service.IngestionService/IngestResults',
    requestStream: false,
    responseStream: false,
    requestType: ingestion_service_pb.IngestResultsRequest,
    responseType: ingestion_service_pb.IngestResultsResponse,
    requestSerialize: serialize_bmcp_ingestion_service_IngestResultsRequest,
    requestDeserialize: deserialize_bmcp_ingestion_service_IngestResultsRequest,
    responseSerialize: serialize_bmcp_ingestion_service_IngestResultsResponse,
    responseDeserialize: deserialize_bmcp_ingestion_service_IngestResultsResponse,
  },
  // ResolvePendingRelationships resolves pending relationships in the Neo4j database
resolvePendingRelationships: {
    path: '/bmcp.ingestion_service.IngestionService/ResolvePendingRelationships',
    requestStream: false,
    responseStream: false,
    requestType: ingestion_service_pb.ResolvePendingRelationshipsRequest,
    responseType: ingestion_service_pb.ResolvePendingRelationshipsResponse,
    requestSerialize: serialize_bmcp_ingestion_service_ResolvePendingRelationshipsRequest,
    requestDeserialize: deserialize_bmcp_ingestion_service_ResolvePendingRelationshipsRequest,
    responseSerialize: serialize_bmcp_ingestion_service_ResolvePendingRelationshipsResponse,
    responseDeserialize: deserialize_bmcp_ingestion_service_ResolvePendingRelationshipsResponse,
  },
};

exports.IngestionServiceClient = grpc.makeGenericClientConstructor(IngestionServiceService, 'IngestionService');
