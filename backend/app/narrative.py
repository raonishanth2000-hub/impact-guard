"""Plain-language narrative for a change.

Turns one control-plane event into something a person can act on without
knowing the API: what the world looked like before, what it looks like now,
what could go wrong, what should have been checked first, and how to say it to
someone who does not work in the console.

THE HONESTY RULE, and the whole reason this module is careful:

CloudTrail records the *request that was made*, not a diff of the resource. So
there are two very different situations, and they must never be presented the
same way:

  derivable   The API's own meaning tells us the prior state. "Authorize
              ingress" only makes sense if the rule was not there before;
              "Stop instances" only makes sense if they were running. We can
              state the before-state because the operation implies it.

  unrecorded  A configuration write carries the new value and nothing else.
              We know the timeout is now 3 seconds; we have no idea what it
              was. Saying "was 30s" would be fabrication.

Every narrative carries `before_known` so the interface can show the second
case as an explicit gap rather than quietly omitting it.
"""

from typing import Any

# --------------------------------------------------------------------------
# Per-event narrative. `plain` avoids API vocabulary entirely; an on-call
# engineer's manager should be able to read it.
#
# Fields:
#   plain        one sentence, no jargon, describing what a person did
#   before       state prior to the change ('' when unrecorded)
#   after        state following the change
#   before_known whether `before` is derivable from the operation's meaning
#   risks        what this change can plausibly break
#   checklist    what should have been verified before shipping it
#   recommend    the single most useful next action
# --------------------------------------------------------------------------

def _get(detail: dict, *keys, default=None):
    for k in keys:
        if k in detail and detail[k] not in (None, ''):
            return detail[k]
    return default


def _ports(detail: dict) -> str:
    """Render the port range from a security-group payload, if present."""
    found = []

    def walk(v):
        if isinstance(v, dict):
            for k, val in v.items():
                if k in ('fromPort', 'toPort') and isinstance(val, int):
                    found.append(val)
                else:
                    walk(val)
        elif isinstance(v, list):
            for item in v:
                walk(item)

    walk(detail)
    if not found:
        return 'a network port'
    lo, hi = min(found), max(found)
    return f'port {lo}' if lo == hi else f'ports {lo}-{hi}'


def _cidrs(detail: dict) -> str:
    found = []

    def walk(v):
        if isinstance(v, dict):
            for k, val in v.items():
                if k == 'cidrIp' and isinstance(val, str):
                    found.append(val)
                else:
                    walk(val)
        elif isinstance(v, list):
            for item in v:
                walk(item)

    walk(detail)
    if '0.0.0.0/0' in found:
        return 'anywhere on the internet'
    if found:
        return f'{found[0]}'
    return 'a new source'


def _rds(change) -> dict:
    d = change.change_detail or {}
    size = _get(d, 'dBInstanceClass')
    immediate = d.get('applyImmediately') is True
    bits = []
    if size:
        bits.append(f'a different size ({size})')
    if 'multiAZ' in d:
        bits.append('standby-copy setting changed' if not d['multiAZ'] else 'a standby copy in another location')
    if 'allocatedStorage' in d:
        bits.append(f"storage set to {d['allocatedStorage']}GB")
    what = ', '.join(bits) if bits else 'settings changed'

    return {
        'plain': (
            f'Someone changed settings on the {change.resource_id} database'
            + (' and applied it straight away rather than waiting for the next '
               'maintenance window' if immediate else '')
            + '.'
        ),
        'before': f'The database was running with its previous settings.',
        'after': f'The database now has {what}.',
        'before_known': False,
        'risks': [
            'Applying database changes immediately can restart or briefly pause the '
            'database, dropping connections that are open at that moment.',
            'A smaller instance size can leave the database unable to keep up with '
            'normal traffic, which shows up as slow or timing-out requests.',
            'Turning off the standby copy removes automatic failover, so a hardware '
            'fault becomes an outage rather than a blip.',
        ],
        'checklist': [
            'Confirm the new size has been load-tested against realistic traffic.',
            'Check whether the change requires a restart, and whether that was '
            'scheduled for a quiet period.',
            'Verify connection limits still comfortably exceed what the application '
            'opens at peak.',
            'Make sure a recent backup or snapshot exists before applying.',
            'Agree how the change will be reversed if it goes wrong, and how long '
            'reversing takes.',
        ],
        'recommend': (
            'Compare database response times and connection counts either side of '
            'this change before looking anywhere else.'
        ),
    }


def _lambda_config(change) -> dict:
    d = change.change_detail or {}
    timeout = d.get('timeout')
    memory = d.get('memorySize')
    bits = []
    if timeout is not None:
        bits.append(f'gives up after {timeout} second{"s" if timeout != 1 else ""}')
    if memory is not None:
        bits.append(f'has {memory}MB of memory')
    what = ' and '.join(bits) if bits else 'has different settings'

    return {
        'plain': (
            f'Someone changed how the {change.resource_id} service is configured'
            + (f' — it now gives up on work after {timeout} second'
               f'{"s" if timeout != 1 else ""}.' if timeout is not None else '.')
        ),
        'before': 'The service was running with its previous settings.',
        'after': f'The service now {what}.',
        'before_known': False,
        'risks': [
            'A shorter give-up time makes the service abandon work that used to '
            'finish, which users experience as failed or timed-out requests.',
            'Less memory also means less processing speed, so everything the service '
            'does takes longer.',
            'Changed settings apply to new work immediately — there is no gradual '
            'rollout to catch a mistake early.',
        ],
        'checklist': [
            'Check how long this service normally takes at its slowest, and confirm '
            'the new limit is comfortably above that.',
            'Confirm anything this service waits on (databases, other services) can '
            'reliably answer within the new limit.',
            'Verify the change was tried in a test environment under realistic load.',
            'Know how to put the previous settings back, and how quickly.',
        ],
        'recommend': (
            'Check this service’s error and timeout rate immediately before and after '
            'the change — a limit set too low shows up within minutes.'
        ),
    }


def _lambda_code(change) -> dict:
    return {
        'plain': f'Someone released new code for the {change.resource_id} service.',
        'before': 'The previous version of the code was serving all traffic.',
        'after': 'The new version is serving all traffic.',
        'before_known': True,
        'risks': [
            'A release replaces the running code for everyone at once, so a fault '
            'reaches all users rather than a small share.',
            'Problems introduced by a release often appear only under real traffic, '
            'minutes after it completes.',
        ],
        'checklist': [
            'Confirm the release passed its automated tests.',
            'Confirm what changed in this release and who reviewed it.',
            'Check that the previous version is still available to roll back to.',
            'Agree who is watching error rates for the first few minutes afterwards.',
        ],
        'recommend': (
            'Compare this service’s error rate before and after the release. If it '
            'moved, rolling back to the previous version is the fastest way to confirm '
            'the release is responsible.'
        ),
    }


def _sg_authorize(change) -> dict:
    ports = _ports(change.change_detail or {})
    source = _cidrs(change.change_detail or {})
    wide = source == 'anywhere on the internet'

    return {
        'plain': (
            f'Someone opened {ports} on {change.resource_id} so it can be reached from '
            f'{source}.'
        ),
        'before': f'Nothing could reach {ports} on this group from {source}.',
        'after': f'Anything at {source} can now reach {ports}.',
        'before_known': True,
        'risks': (
            [
                'Opening a port to the whole internet exposes it to automated scanning '
                'within minutes, whether or not anyone intended it to be public.',
                'If that port belongs to a database, the data behind it is only as safe '
                'as its password.',
            ] if wide else [
                'Widening network access increases the number of places a problem can '
                'come from.',
                'Access rules are easy to add and easy to forget, so temporary openings '
                'tend to become permanent.',
            ]
        ) + [
            'More traffic reaching a service can also change its load, which can look '
            'like a performance problem rather than a security one.',
        ],
        'checklist': [
            'Confirm who asked for this access and why.',
            'Check the source is as narrow as it can be — a specific address or group '
            'rather than the whole internet.',
            'Confirm whatever is behind the port requires authentication.',
            'Agree when this opening should be closed again, if it is temporary.',
        ],
        'recommend': (
            'Confirm this opening was intended. If it was not, close it first and '
            'investigate afterwards.'
        ),
    }


def _sg_revoke(change) -> dict:
    ports = _ports(change.change_detail or {})
    return {
        'plain': f'Someone closed {ports} on {change.resource_id}.',
        'before': f'Traffic was allowed to reach {ports} on this group.',
        'after': f'That traffic is now blocked.',
        'before_known': True,
        'risks': [
            'Closing a port stops any legitimate traffic that depended on it, usually '
            'immediately and without warning.',
            'The effect shows up as connection failures that can look like the other '
            'service being down.',
        ],
        'checklist': [
            'Confirm nothing still relies on this route before removing it.',
            'Check whether the rule was added recently as part of an ongoing piece of '
            'work.',
            'Note who removed it, so it is not silently re-added later.',
        ],
        'recommend': (
            'If services started failing to connect around this time, this change is '
            'the first thing to put back.'
        ),
    }


def _run_instances(change) -> dict:
    return {
        'plain': f'Someone started up new machines ({change.resource_id}).',
        'before': 'These machines did not exist.',
        'after': 'They are running and may be taking traffic.',
        'before_known': True,
        'risks': [
            'New machines join the pool before they are necessarily ready, so a share '
            'of traffic can fail while they warm up.',
            'Machines started by hand often miss the configuration that automated ones '
            'get.',
        ],
        'checklist': [
            'Confirm the new machines passed their health checks before taking traffic.',
            'Confirm they were created the same way as the existing ones.',
            'Check the cost impact if this was not a planned increase.',
        ],
        'recommend': 'Check whether these machines are healthy and actually serving traffic.',
    }


def _stop_instances(change) -> dict:
    return {
        'plain': f'Someone shut down running machines ({change.resource_id}).',
        'before': 'These machines were running.',
        'after': 'They are stopped and serving nothing.',
        'before_known': True,
        'risks': [
            'Capacity drops immediately, so the remaining machines absorb all the '
            'traffic and may struggle.',
            'Anything running only on those machines stopped with them.',
        ],
        'checklist': [
            'Confirm the remaining capacity can carry the full load.',
            'Confirm nothing unique was running only on these machines.',
            'Check this was intended rather than the wrong machines being selected.',
        ],
        'recommend': (
            'Check whether the remaining machines are now under more load than they '
            'can handle.'
        ),
    }


def _terminate_instances(change) -> dict:
    return {
        'plain': f'Someone permanently destroyed machines ({change.resource_id}).',
        'before': 'These machines existed.',
        'after': 'They are gone and cannot be restarted.',
        'before_known': True,
        'risks': [
            'This cannot be undone. Anything stored only on those machines is lost.',
            'Capacity drops immediately and does not come back on its own.',
        ],
        'checklist': [
            'Confirm anything valuable was backed up or stored elsewhere first.',
            'Confirm the correct machines were selected.',
            'Confirm replacement capacity exists or will start automatically.',
        ],
        'recommend': (
            'Confirm this was intended, then check whether capacity needs replacing.'
        ),
    }


def _put_bucket_policy(change) -> dict:
    return {
        'plain': f'Someone replaced the access rules on the {change.resource_id} file store.',
        'before': 'The previous access rules were in force. Their contents are not recorded.',
        'after': 'A new set of access rules is in force.',
        'before_known': False,
        'risks': [
            'Access rules are replaced wholesale, not merged — anything the previous '
            'rules allowed and the new ones do not is now blocked.',
            'A rule that is too open can make private files readable by anyone.',
        ],
        'checklist': [
            'Confirm the new rules still allow everything that legitimately needs access.',
            'Confirm nothing is open to the public that should not be.',
            'Keep a copy of the previous rules so they can be restored.',
        ],
        'recommend': (
            'Check whether anything started failing to read or write files around this '
            'time.'
        ),
    }


def _delete_bucket_policy(change) -> dict:
    return {
        'plain': f'Someone removed the access rules from the {change.resource_id} file store.',
        'before': 'Access rules were controlling who could read and write.',
        'after': 'Those rules are gone; access now falls back to other settings.',
        'before_known': True,
        'risks': [
            'Anything that relied on those rules for access will now be refused.',
            'Removing rules can also remove protections, depending on what else is '
            'configured.',
        ],
        'checklist': [
            'Confirm nothing depended on the removed rules.',
            'Confirm access is still restricted by something.',
            'Keep a copy of what was removed.',
        ],
        'recommend': 'Check for permission errors from anything using this file store.',
    }


def _asg(change) -> dict:
    d = change.change_detail or {}
    desired = d.get('desiredCapacity')
    return {
        'plain': (
            f'Someone changed how many machines the {change.resource_id} group runs'
            + (f' — it now aims for {desired}.' if desired is not None else '.')
        ),
        'before': 'The group was running its previous number of machines.',
        'after': f'The group now aims for {desired} machines.' if desired is not None
                 else 'The group now has different capacity settings.',
        'before_known': False,
        'risks': [
            'Reducing capacity means the remaining machines carry more traffic each, '
            'which can push response times up.',
            'Increasing capacity costs more, and new machines take time to become '
            'useful.',
        ],
        'checklist': [
            'Confirm the new number covers peak traffic, not just the average.',
            'Confirm machines pass their health checks before receiving traffic.',
            'Check the cost impact of the new number.',
        ],
        'recommend': (
            'Check whether response times changed after this, and whether all machines '
            'are healthy.'
        ),
    }


BUILDERS = {
    'ModifyDBInstance': _rds,
    'UpdateFunctionConfiguration': _lambda_config,
    'UpdateFunctionCode': _lambda_code,
    'AuthorizeSecurityGroupIngress': _sg_authorize,
    'RevokeSecurityGroupIngress': _sg_revoke,
    'RunInstances': _run_instances,
    'StopInstances': _stop_instances,
    'TerminateInstances': _terminate_instances,
    'PutBucketPolicy': _put_bucket_policy,
    'DeleteBucketPolicy': _delete_bucket_policy,
    'UpdateAutoScalingGroup': _asg,
}


def _generic(change) -> dict:
    return {
        'plain': f'Someone changed {change.resource_id}.',
        'before': 'The previous state is not recorded.',
        'after': 'The change has been applied.',
        'before_known': False,
        'risks': ['This change type is not yet described in plain language, so its '
                  'effects have not been assessed.'],
        'checklist': ['Review the request details and confirm the change was intended.'],
        'recommend': 'Review this change with whoever made it.',
    }


def describe(change) -> dict[str, Any]:
    """Build the plain-language narrative for one change."""
    builder = BUILDERS.get(change.event_name, _generic)
    out = builder(change)

    # A failed call changed nothing. Saying otherwise would be wrong.
    if change.error_code:
        out = {
            **out,
            'plain': out['plain'].replace('Someone ', 'Someone tried to ', 1)
                     + ' The attempt was refused, so nothing changed.',
            'before': 'Unchanged.',
            'after': 'Unchanged — the request was refused.',
            'before_known': True,
            'risks': ['Nothing changed, but a refused attempt is worth understanding: '
                      'either someone lacked the access they expected, or they were '
                      'acting outside their remit.'],
            'checklist': ['Confirm who attempted this and whether they should have been '
                          'able to.'],
            'recommend': 'Check why this was refused rather than whether it broke anything.',
        }

    out['actor_plain'] = _actor_plain(change)
    return out


def _actor_plain(change) -> str:
    """Describe who made the change without assuming AWS vocabulary."""
    actor = change.actor or 'someone'
    kind = (change.actor_type or '').lower()
    if 'service' in kind:
        return f'An automated system ({actor}) made this change on its own.'
    if 'assumedrole' in kind:
        return (f'Made by "{actor}" — an automated process or a person acting through '
                'shared access, not a named individual.')
    if 'iamuser' in kind:
        return f'Made by "{actor}", a named individual account.'
    return f'Made by "{actor}".'


def briefing(scored, incident, stats) -> dict[str, Any]:
    """A summary written for someone who does not work in the console.

    Deliberately states uncertainty. A manager reading this should come away
    knowing what is suspected, what is confirmed, and what is still unknown.
    """
    before = [s for s in scored if s.occurred_before_incident]
    lead = before[0] if before else None
    description = incident.get('description') or 'A problem was reported'
    window = incident.get('lookback_minutes')

    if not lead:
        headline = (
            f'{description}. Nothing was changed in the {window} minutes beforehand, '
            'so the cause is likely to lie outside recent configuration work.'
        )
        confidence = 'No candidate changes'
    else:
        n = _actor_plain(lead.change)
        headline = (
            f'{description}. In the {window} minutes beforehand, {stats["before_incident"]} '
            f'change{"s" if stats["before_incident"] != 1 else ""} were made. The one that '
            f'most warrants attention happened '
            f'{abs(int(lead.minutes_from_incident))} minute'
            f'{"s" if abs(int(lead.minutes_from_incident)) != 1 else ""} before the problem '
            f'was reported. {n}'
        )
        confidence = (
            'Timing and scope make this worth investigating first'
            if lead.relevance == 'HIGH'
            else 'No change stands out strongly; these are the closest candidates'
        )

    return {
        'headline': headline,
        'confidence': confidence,
        'certain': [
            f'{stats["total"]} change{"s" if stats["total"] != 1 else ""} were recorded in '
            f'the window examined.',
            f'{stats["before_incident"]} of them happened before the problem was reported.',
        ] + ([
            f'The highest-priority one affected "{lead.change.resource_id}".',
        ] if lead else []),
        'uncertain': [
            'Nothing here proves what caused the problem. These changes are close in '
            'time and touch sensitive parts of the system, which is a reason to look, '
            'not a conclusion.',
            'Some settings only record what they were changed *to*, not what they were '
            'before, so a few comparisons cannot be made from this data alone.',
        ],
        'next': [
            'Confirm or rule out the highest-priority change by checking the affected '
            'system’s own measurements.',
            'If it is confirmed, decide whether reversing it is faster than fixing '
            'forward.',
            'Record what was learned so the same check is quicker next time.',
        ],
    }
