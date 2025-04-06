from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class AnalyzeCodeRequest(_message.Message):
    __slots__ = ("code_path", "output_path")
    CODE_PATH_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_PATH_FIELD_NUMBER: _ClassVar[int]
    code_path: str
    output_path: str
    def __init__(self, code_path: _Optional[str] = ..., output_path: _Optional[str] = ...) -> None: ...

class AnalyzeCodeResponse(_message.Message):
    __slots__ = ("success", "message", "cpg_output_path")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    CPG_OUTPUT_PATH_FIELD_NUMBER: _ClassVar[int]
    success: bool
    message: str
    cpg_output_path: str
    def __init__(self, success: bool = ..., message: _Optional[str] = ..., cpg_output_path: _Optional[str] = ...) -> None: ...
