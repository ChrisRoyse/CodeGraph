from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CodeLocation(_message.Message):
    __slots__ = ("file_path", "start_line", "start_column", "end_line", "end_column")
    FILE_PATH_FIELD_NUMBER: _ClassVar[int]
    START_LINE_FIELD_NUMBER: _ClassVar[int]
    START_COLUMN_FIELD_NUMBER: _ClassVar[int]
    END_LINE_FIELD_NUMBER: _ClassVar[int]
    END_COLUMN_FIELD_NUMBER: _ClassVar[int]
    file_path: str
    start_line: int
    start_column: int
    end_line: int
    end_column: int
    def __init__(self, file_path: _Optional[str] = ..., start_line: _Optional[int] = ..., start_column: _Optional[int] = ..., end_line: _Optional[int] = ..., end_column: _Optional[int] = ...) -> None: ...

class GraphNode(_message.Message):
    __slots__ = ("global_id", "node_type", "secondary_labels", "properties", "location", "code_snippet")
    class PropertiesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    GLOBAL_ID_FIELD_NUMBER: _ClassVar[int]
    NODE_TYPE_FIELD_NUMBER: _ClassVar[int]
    SECONDARY_LABELS_FIELD_NUMBER: _ClassVar[int]
    PROPERTIES_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    CODE_SNIPPET_FIELD_NUMBER: _ClassVar[int]
    global_id: str
    node_type: str
    secondary_labels: _containers.RepeatedScalarFieldContainer[str]
    properties: _containers.ScalarMap[str, str]
    location: CodeLocation
    code_snippet: str
    def __init__(self, global_id: _Optional[str] = ..., node_type: _Optional[str] = ..., secondary_labels: _Optional[_Iterable[str]] = ..., properties: _Optional[_Mapping[str, str]] = ..., location: _Optional[_Union[CodeLocation, _Mapping]] = ..., code_snippet: _Optional[str] = ...) -> None: ...

class GraphRelationship(_message.Message):
    __slots__ = ("source_node_global_id", "target_node_global_id", "relationship_type", "properties", "location")
    class PropertiesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    SOURCE_NODE_GLOBAL_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_NODE_GLOBAL_ID_FIELD_NUMBER: _ClassVar[int]
    RELATIONSHIP_TYPE_FIELD_NUMBER: _ClassVar[int]
    PROPERTIES_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    source_node_global_id: str
    target_node_global_id: str
    relationship_type: str
    properties: _containers.ScalarMap[str, str]
    location: CodeLocation
    def __init__(self, source_node_global_id: _Optional[str] = ..., target_node_global_id: _Optional[str] = ..., relationship_type: _Optional[str] = ..., properties: _Optional[_Mapping[str, str]] = ..., location: _Optional[_Union[CodeLocation, _Mapping]] = ...) -> None: ...

class IngestGraphRequest(_message.Message):
    __slots__ = ("batch_id", "nodes", "relationships", "full_update")
    BATCH_ID_FIELD_NUMBER: _ClassVar[int]
    NODES_FIELD_NUMBER: _ClassVar[int]
    RELATIONSHIPS_FIELD_NUMBER: _ClassVar[int]
    FULL_UPDATE_FIELD_NUMBER: _ClassVar[int]
    batch_id: str
    nodes: _containers.RepeatedCompositeFieldContainer[GraphNode]
    relationships: _containers.RepeatedCompositeFieldContainer[GraphRelationship]
    full_update: bool
    def __init__(self, batch_id: _Optional[str] = ..., nodes: _Optional[_Iterable[_Union[GraphNode, _Mapping]]] = ..., relationships: _Optional[_Iterable[_Union[GraphRelationship, _Mapping]]] = ..., full_update: bool = ...) -> None: ...

class IngestGraphResponse(_message.Message):
    __slots__ = ("success", "nodes_processed", "relationships_processed", "error_message")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    NODES_PROCESSED_FIELD_NUMBER: _ClassVar[int]
    RELATIONSHIPS_PROCESSED_FIELD_NUMBER: _ClassVar[int]
    ERROR_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    success: bool
    nodes_processed: int
    relationships_processed: int
    error_message: str
    def __init__(self, success: bool = ..., nodes_processed: _Optional[int] = ..., relationships_processed: _Optional[int] = ..., error_message: _Optional[str] = ...) -> None: ...
