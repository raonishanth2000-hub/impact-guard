"""Generated sample CloudTrail events for an e-commerce environment.

Kept strictly separate from the live AWS path (see cloudtrail.py). Demo events
are generated *relative to the incident time* so the scenario always looks
current no matter when it is demoed.

The shapes here mirror real CloudTrail events closely enough that the same
normalizer handles both without special cases.

Headline scenario (offsets from the incident):
    -7 min  security group opened on prod-web-security-group
    -3 min  prod-checkout-api Lambda timeout lowered 30s -> 3s
    -1 min  prod-orders-db modified, applyImmediately=true
     0 min  checkout requests start timing out
Surrounding events are realistic noise that the scoring engine should rank below
these, which is what makes the ranking visibly non-trivial in the demo.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

DEMO_INCIDENT_DESCRIPTION = "Checkout requests started timing out"

_ASSUMED_ROLE = "AssumedRole"


def _role_identity(role: str, session: str) -> dict[str, Any]:
    return {
        "type": _ASSUMED_ROLE,
        "principalId": f"AROAEXAMPLE:{session}",
        "arn": f"arn:aws:sts::123456789012:assumed-role/{role}/{session}",
        "accountId": "123456789012",
        "sessionContext": {
            "sessionIssuer": {
                "type": "Role",
                "principalId": "AROAEXAMPLE",
                "arn": f"arn:aws:iam::123456789012:role/{role}",
                "accountId": "123456789012",
                "userName": role,
            }
        },
    }


def _user_identity(user_name: str) -> dict[str, Any]:
    return {
        "type": "IAMUser",
        "principalId": "AIDAEXAMPLE",
        "arn": f"arn:aws:iam::123456789012:user/{user_name}",
        "accountId": "123456789012",
        "userName": user_name,
    }


def _event(
    *,
    offset_minutes: float,
    incident_time: datetime,
    event_name: str,
    event_source: str,
    identity: dict[str, Any],
    request_parameters: dict[str, Any],
    source_ip: str = "203.0.113.42",
    user_agent: str = "aws-cli/2.15.0 Python/3.11",
    region: str = "ap-south-1",
    error_code: str | None = None,
) -> dict[str, Any]:
    event_time = incident_time + timedelta(minutes=offset_minutes)
    event: dict[str, Any] = {
        "eventVersion": "1.09",
        "eventID": str(uuid.uuid4()),
        "eventTime": event_time.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "eventName": event_name,
        "eventSource": event_source,
        "eventType": "AwsApiCall",
        "awsRegion": region,
        "sourceIPAddress": source_ip,
        "userAgent": user_agent,
        "userIdentity": identity,
        "requestParameters": request_parameters,
        "recipientAccountId": "123456789012",
        "managementEvent": True,
        "readOnly": False,
    }
    if error_code:
        event["errorCode"] = error_code
    return event


def generate_demo_events(incident_time: datetime) -> list[dict[str, Any]]:
    """Build the full demo timeline around `incident_time`."""
    deploy = _role_identity("deploy-role", "github-actions-4471")
    platform = _role_identity("platform-admin", "priya-console")
    oncall = _user_identity("arjun.mehta")
    autoscaler = {
        "type": "AWSService",
        "invokedBy": "autoscaling.amazonaws.com",
    }

    events = [
        # ---- Background noise, well before the incident ----
        _event(
            offset_minutes=-28,
            incident_time=incident_time,
            event_name="ModifyDBInstance",
            event_source="rds.amazonaws.com",
            identity=platform,
            request_parameters={
                "dBInstanceIdentifier": "analytics-replica-01",
                "backupRetentionPeriod": 7,
                "applyImmediately": False,
            },
        ),
        _event(
            offset_minutes=-24,
            incident_time=incident_time,
            event_name="UpdateFunctionCode",
            event_source="lambda.amazonaws.com",
            identity=deploy,
            request_parameters={
                "functionName": "prod-payment-lambda",
                "s3Bucket": "acme-deploy-artifacts",
                "s3Key": "payment/build-2291.zip",
                "publish": True,
            },
            user_agent="aws-sdk-go/1.49.0 (github-actions)",
        ),
        _event(
            offset_minutes=-19,
            incident_time=incident_time,
            event_name="RunInstances",
            event_source="ec2.amazonaws.com",
            identity=oncall,
            request_parameters={
                "instancesSet": {"items": [{"instanceId": "i-0a91f3c7de2b45881"}]},
                "instanceType": "t3.medium",
                "imageId": "ami-0f5ee92e2d63afc18",
            },
            source_ip="198.51.100.7",
        ),
        _event(
            offset_minutes=-14,
            incident_time=incident_time,
            event_name="PutBucketPolicy",
            event_source="s3.amazonaws.com",
            identity=platform,
            request_parameters={
                "bucketName": "acme-static-assets",
                "policy": '{"Version":"2012-10-17","Statement":[{"Effect":"Allow",'
                          '"Principal":"*","Action":"s3:GetObject"}]}',
            },
        ),
        _event(
            offset_minutes=-11,
            incident_time=incident_time,
            event_name="UpdateAutoScalingGroup",
            event_source="autoscaling.amazonaws.com",
            identity=autoscaler,
            request_parameters={
                "autoScalingGroupName": "prod-web-asg",
                "desiredCapacity": 6,
                "minSize": 4,
                "maxSize": 12,
            },
            user_agent="autoscaling.amazonaws.com",
        ),
        _event(
            offset_minutes=-9,
            incident_time=incident_time,
            event_name="StopInstances",
            event_source="ec2.amazonaws.com",
            identity=oncall,
            request_parameters={
                "instancesSet": {"items": [{"instanceId": "i-0dd4b8f1c93ae7712"}]},
                "force": False,
            },
            source_ip="198.51.100.7",
        ),
        # A failed call - the engine should damp this to near-zero.
        _event(
            offset_minutes=-8,
            incident_time=incident_time,
            event_name="TerminateInstances",
            event_source="ec2.amazonaws.com",
            identity=oncall,
            request_parameters={
                "instancesSet": {"items": [{"instanceId": "i-0bb27c41e0f9a3d55"}]},
            },
            error_code="Client.UnauthorizedOperation",
            source_ip="198.51.100.7",
        ),

        # ---- The three changes that matter ----
        _event(
            offset_minutes=-7,
            incident_time=incident_time,
            event_name="AuthorizeSecurityGroupIngress",
            event_source="ec2.amazonaws.com",
            identity=platform,
            request_parameters={
                "groupId": "sg-0c4419ab2ff77e310",
                "groupName": "prod-web-security-group",
                "ipPermissions": {
                    "items": [
                        {
                            "ipProtocol": "tcp",
                            "fromPort": 5432,
                            "toPort": 5432,
                            "ipRanges": {"items": [{"cidrIp": "0.0.0.0/0"}]},
                        }
                    ]
                },
            },
            source_ip="203.0.113.19",
            user_agent="console.amazonaws.com",
        ),
        _event(
            offset_minutes=-3,
            incident_time=incident_time,
            event_name="UpdateFunctionConfiguration",
            event_source="lambda.amazonaws.com",
            identity=deploy,
            request_parameters={
                "functionName": "prod-checkout-api",
                "timeout": 3,
                "memorySize": 512,
                "environment": {
                    "variables": {
                        "DB_POOL_SIZE": "5",
                        "ORDERS_DB_HOST": "prod-orders-db.abc123.ap-south-1.rds.amazonaws.com",
                    }
                },
            },
            user_agent="aws-sdk-go/1.49.0 (github-actions)",
        ),
        _event(
            offset_minutes=-1,
            incident_time=incident_time,
            event_name="ModifyDBInstance",
            event_source="rds.amazonaws.com",
            identity=deploy,
            request_parameters={
                "dBInstanceIdentifier": "prod-orders-db",
                "dBInstanceClass": "db.t3.medium",
                "applyImmediately": True,
                "multiAZ": False,
            },
            user_agent="aws-sdk-go/1.49.0 (github-actions)",
        ),

        # ---- After the incident: remediation, not a cause ----
        _event(
            offset_minutes=+2,
            incident_time=incident_time,
            event_name="RevokeSecurityGroupIngress",
            event_source="ec2.amazonaws.com",
            identity=platform,
            request_parameters={
                "groupId": "sg-0c4419ab2ff77e310",
                "groupName": "prod-web-security-group",
                "ipPermissions": {
                    "items": [
                        {
                            "ipProtocol": "tcp",
                            "fromPort": 5432,
                            "toPort": 5432,
                            "ipRanges": {"items": [{"cidrIp": "0.0.0.0/0"}]},
                        }
                    ]
                },
            },
            source_ip="203.0.113.19",
            user_agent="console.amazonaws.com",
        ),
    ]

    return events


def fetch_demo_events(
    start_time: datetime, end_time: datetime, incident_time: datetime | None = None
) -> list[dict[str, Any]]:
    """Demo-mode analogue of the live CloudTrail fetch.

    Anchors the scenario on the incident (or the window end) and returns only the
    events inside [start_time, end_time], mirroring CloudTrail's behaviour.
    """
    anchor = incident_time or end_time
    events = generate_demo_events(anchor)

    def in_window(event: dict[str, Any]) -> bool:
        ts = datetime.fromisoformat(event["eventTime"].replace("Z", "+00:00"))
        return start_time <= ts <= end_time

    return [e for e in events if in_window(e)]
