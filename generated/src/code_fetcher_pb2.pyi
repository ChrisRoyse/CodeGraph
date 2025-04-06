from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

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

class FetchCodeRequest(_message.Message):
    __slots__ = ("repository_url",)
    REPOSITORY_URL_FIELD_NUMBER: _ClassVar[int]
    repository_url: str
    def __init__(self, repository_url: _Optional[str] = ...) -> None: ...

class FetchCodeResponse(_message.Message):
    __slots__ = ("local_path", "status", "message")
    LOCAL_PATH_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    local_path: str
    status: Status
    message: str
    def __init__(self, local_path: _Optional[str] = ..., status: _Optional[_Union[Status, str]] = ..., message: _Optional[str] = ...) -> None: ...
