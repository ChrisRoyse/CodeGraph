from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Status(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    UNKNOWN: _ClassVar[Status]
    SUCCESS: _ClassVar[Status]
    FAILURE: _ClassVar[Status]
    IN_PROGRESS: _ClassVar[Status]
UNKNOWN: Status
SUCCESS: Status
FAILURE: Status
IN_PROGRESS: Status

class FilteredNode(_message.Message):
    __slots__ = ("entity_id", "filepath", "properties")
    ENTITY_ID_FIELD_NUMBER: _ClassVar[int]
    FILEPATH_FIELD_NUMBER: _ClassVar[int]
    PROPERTIES_FIELD_NUMBER: _ClassVar[int]
    entity_id: str
    filepath: str
    properties: _struct_pb2.Struct
    def __init__(self, entity_id: _Optional[str] = ..., filepath: _Optional[str] = ..., properties: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class FilteredRelationship(_message.Message):
    __slots__ = ("entity_id", "start_node_id", "end_node_id", "type", "properties")
    ENTITY_ID_FIELD_NUMBER: _ClassVar[int]
    START_NODE_ID_FIELD_NUMBER: _ClassVar[int]
    END_NODE_ID_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    PROPERTIES_FIELD_NUMBER: _ClassVar[int]
    entity_id: str
    start_node_id: str
    end_node_id: str
    type: str
    properties: _struct_pb2.Struct
    def __init__(self, entity_id: _Optional[str] = ..., start_node_id: _Optional[str] = ..., end_node_id: _Optional[str] = ..., type: _Optional[str] = ..., properties: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class IngestCpgRequest(_message.Message):
    __slots__ = ("filtered_nodes", "filtered_relationships", "deleted_files")
    FILTERED_NODES_FIELD_NUMBER: _ClassVar[int]
    FILTERED_RELATIONSHIPS_FIELD_NUMBER: _ClassVar[int]
    DELETED_FILES_FIELD_NUMBER: _ClassVar[int]
    filtered_nodes: _containers.RepeatedCompositeFieldContainer[FilteredNode]
    filtered_relationships: _containers.RepeatedCompositeFieldContainer[FilteredRelationship]
    deleted_files: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, filtered_nodes: _Optional[_Iterable[_Union[FilteredNode, _Mapping]]] = ..., filtered_relationships: _Optional[_Iterable[_Union[FilteredRelationship, _Mapping]]] = ..., deleted_files: _Optional[_Iterable[str]] = ...) -> None: ...

class IngestCpgResponse(_message.Message):
    __slots__ = ("status", "message")
    STATUS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    status: Status
    message: str
    def __init__(self, status: _Optional[_Union[Status, str]] = ..., message: _Optional[str] = ...) -> None: ...
