"""Typed errors that map cleanly onto HTTP status codes.

Anything raised as an ApiError produces a structured JSON response. Anything
else becomes a 500 with a generic message, so internal details never leak to
the client.
"""


class ApiError(Exception):
    status_code = 500
    code = "internal_error"

    def __init__(self, message: str, *, detail: str | None = None):
        super().__init__(message)
        self.message = message
        self.detail = detail

    def to_dict(self) -> dict:
        body = {"error": {"code": self.code, "message": self.message}}
        if self.detail:
            body["error"]["detail"] = self.detail
        return body


class ValidationError(ApiError):
    status_code = 400
    code = "validation_error"


class InvalidJsonError(ValidationError):
    """The request body could not be parsed.

    Distinct from ValidationError so both transports report the same code for
    the same failure: local_server.py already answered `invalid_json`, while
    the Lambda swallowed the error entirely.
    """

    code = "invalid_json"


class NotFoundError(ApiError):
    status_code = 404
    code = "not_found"


class UpstreamPermissionError(ApiError):
    """IAM denied the call. Actionable for the operator, so we surface it clearly."""
    status_code = 403
    code = "permission_denied"


class UpstreamUnavailableError(ApiError):
    """CloudTrail or Bedrock could not be reached."""
    status_code = 503
    code = "upstream_unavailable"
