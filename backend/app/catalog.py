"""Registry of the AWS events we understand.

THIS IS THE EXTENSION POINT. To support a new event type, add one `register(...)`
call at the bottom of this file. Nothing else in the codebase needs to change:
normalization, scoring and the UI all read from this registry.

We deliberately support a focused set rather than all of AWS. Unknown events are
still collected and displayed, they just receive a generic summary and no
service-specific signal bonuses.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class EventSpec:
    event_name: str
    service: str
    # Free-text label shown in the UI; also used to group the timeline.
    category: str
    # Human summary. `{resource}` is substituted with the extracted resource id.
    summary: str
    resource_type: str = "resource"
    # requestParameters keys searched (in order) to find the resource identifier.
    resource_keys: tuple[str, ...] = ()
    # requestParameters keys worth surfacing in the detail panel.
    detail_keys: tuple[str, ...] = ()
    destructive: bool = False
    security_sensitive: bool = False
    configuration_change: bool = False


# Per-service criticality. Higher = closer to the request path of a typical app,
# so a change there is more worth looking at during an outage.
SERVICE_CRITICALITY: dict[str, int] = {
    "RDS": 12,
    "Lambda": 12,
    "ELB": 12,
    "EC2": 11,
    "AutoScaling": 11,
    "ECS": 11,
    "APIGateway": 10,
    "IAM": 8,
    "S3": 7,
    "CloudFront": 9,
}

_REGISTRY: dict[str, EventSpec] = {}


def register(spec: EventSpec) -> None:
    _REGISTRY[spec.event_name] = spec


def get_spec(event_name: str) -> EventSpec | None:
    return _REGISTRY.get(event_name)


def supported_events() -> list[str]:
    return sorted(_REGISTRY)


def service_criticality(service: str) -> int:
    return SERVICE_CRITICALITY.get(service, 5)


# --------------------------------------------------------------------------
# Supported events (MVP set)
# --------------------------------------------------------------------------

register(EventSpec(
    event_name="ModifyDBInstance",
    service="RDS",
    category="configuration",
    summary="Modified RDS database instance {resource}",
    resource_type="RDS DB instance",
    resource_keys=("dBInstanceIdentifier",),
    detail_keys=(
        "dBInstanceClass", "allocatedStorage", "multiAZ", "applyImmediately",
        "backupRetentionPeriod", "maxAllocatedStorage", "dBParameterGroupName",
    ),
    configuration_change=True,
))

register(EventSpec(
    event_name="UpdateFunctionConfiguration",
    service="Lambda",
    category="configuration",
    summary="Updated Lambda function configuration for {resource}",
    resource_type="Lambda function",
    resource_keys=("functionName",),
    detail_keys=("timeout", "memorySize", "environment", "handler", "runtime"),
    configuration_change=True,
))

register(EventSpec(
    event_name="UpdateFunctionCode",
    service="Lambda",
    category="deployment",
    summary="Deployed new code to Lambda function {resource}",
    resource_type="Lambda function",
    resource_keys=("functionName",),
    detail_keys=("s3Bucket", "s3Key", "imageUri", "publish", "revisionId"),
    configuration_change=True,
))

register(EventSpec(
    event_name="RunInstances",
    service="EC2",
    category="lifecycle",
    summary="Launched EC2 instance(s) {resource}",
    resource_type="EC2 instance",
    resource_keys=("instancesSet", "instanceType"),
    detail_keys=("instanceType", "imageId", "subnetId"),
))

register(EventSpec(
    event_name="StopInstances",
    service="EC2",
    category="lifecycle",
    summary="Stopped EC2 instance(s) {resource}",
    resource_type="EC2 instance",
    resource_keys=("instancesSet",),
    detail_keys=("force",),
    destructive=True,
))

register(EventSpec(
    event_name="TerminateInstances",
    service="EC2",
    category="lifecycle",
    summary="Terminated EC2 instance(s) {resource}",
    resource_type="EC2 instance",
    resource_keys=("instancesSet",),
    destructive=True,
))

register(EventSpec(
    event_name="AuthorizeSecurityGroupIngress",
    service="EC2",
    category="security",
    summary="Added inbound security group rule to {resource}",
    resource_type="Security group",
    # groupName first: the human-readable name is what an engineer recognises,
    # and it is what carries the "prod-" signal for scoring.
    resource_keys=("groupName", "groupId"),
    detail_keys=("ipPermissions", "cidrIp", "fromPort", "toPort", "ipProtocol"),
    security_sensitive=True,
    configuration_change=True,
))

register(EventSpec(
    event_name="RevokeSecurityGroupIngress",
    service="EC2",
    category="security",
    summary="Removed inbound security group rule from {resource}",
    resource_type="Security group",
    resource_keys=("groupName", "groupId"),
    detail_keys=("ipPermissions", "cidrIp", "fromPort", "toPort", "ipProtocol"),
    security_sensitive=True,
    destructive=True,
    configuration_change=True,
))

register(EventSpec(
    event_name="PutBucketPolicy",
    service="S3",
    category="security",
    summary="Replaced the bucket policy on {resource}",
    resource_type="S3 bucket",
    resource_keys=("bucketName",),
    detail_keys=("policy",),
    security_sensitive=True,
    configuration_change=True,
))

register(EventSpec(
    event_name="DeleteBucketPolicy",
    service="S3",
    category="security",
    summary="Deleted the bucket policy on {resource}",
    resource_type="S3 bucket",
    resource_keys=("bucketName",),
    security_sensitive=True,
    destructive=True,
))

register(EventSpec(
    event_name="UpdateAutoScalingGroup",
    service="AutoScaling",
    category="configuration",
    summary="Updated Auto Scaling group {resource}",
    resource_type="Auto Scaling group",
    resource_keys=("autoScalingGroupName",),
    detail_keys=("minSize", "maxSize", "desiredCapacity", "healthCheckGracePeriod"),
    configuration_change=True,
))
