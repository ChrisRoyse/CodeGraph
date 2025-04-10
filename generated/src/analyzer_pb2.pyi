from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Mapping as _Mapping, Optional as _Optional, Union as _Union

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

class Node(_message.Message):
    __slots__ = ("local_id", "global_id_candidate", "node_type", "properties", "location", "code_snippet")
    class PropertiesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    LOCAL_ID_FIELD_NUMBER: _ClassVar[int]
    GLOBAL_ID_CANDIDATE_FIELD_NUMBER: _ClassVar[int]
    NODE_TYPE_FIELD_NUMBER: _ClassVar[int]
    PROPERTIES_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    CODE_SNIPPET_FIELD_NUMBER: _ClassVar[int]
    local_id: int
    global_id_candidate: str
    node_type: str
    properties: _containers.ScalarMap[str, str]
    location: CodeLocation
    code_snippet: str
    def __init__(self, local_id: _Optional[int] = ..., global_id_candidate: _Optional[str] = ..., node_type: _Optional[str] = ..., properties: _Optional[_Mapping[str, str]] = ..., location: _Optional[_Union[CodeLocation, _Mapping]] = ..., code_snippet: _Optional[str] = ...) -> None: ...

class Relationship(_message.Message):
    __slots__ = ("source_node_local_id", "target_node_local_id", "relationship_type", "properties", "location")
    class PropertiesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    SOURCE_NODE_LOCAL_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_NODE_LOCAL_ID_FIELD_NUMBER: _ClassVar[int]
    RELATIONSHIP_TYPE_FIELD_NUMBER: _ClassVar[int]
    PROPERTIES_FIELD_NUMBER: _ClassVar[int]
    LOCATION_FIELD_NUMBER: _ClassVar[int]
    source_node_local_id: int
    target_node_local_id: int
    relationship_type: str
    properties: _containers.ScalarMap[str, str]
    location: CodeLocation
    def __init__(self, source_node_local_id: _Optional[int] = ..., target_node_local_id: _Optional[int] = ..., relationship_type: _Optional[str] = ..., properties: _Optional[_Mapping[str, str]] = ..., location: _Optional[_Union[CodeLocation, _Mapping]] = ...) -> None: ...

class AnalyzeCodeRequest(_message.Message):
    __slots__ = ("file_path", "file_content", "language", "context")
    class ContextEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    FILE_PATH_FIELD_NUMBER: _ClassVar[int]
    FILE_CONTENT_FIELD_NUMBER: _ClassVar[int]
    LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_FIELD_NUMBER: _ClassVar[int]
    file_path: str
    file_content: str
    language: str
    context: _containers.ScalarMap[str, str]
    def __init__(self, file_path: _Optional[str] = ..., file_content: _Optional[str] = ..., language: _Optional[str] = ..., context: _Optional[_Mapping[str, str]] = ...) -> None: ...

class StatusResponse(_message.Message):
    __slots__ = ("status", "message")
    STATUS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    status: str
    message: str
    def __init__(self, status: _Optional[str] = ..., message: _Optional[str] = ...) -> None: ...
