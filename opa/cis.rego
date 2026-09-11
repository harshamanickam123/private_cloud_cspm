package cis

deny contains msg if {
    input.permit_root_login == "permitrootlogin yes"
    msg := sprintf("%s: SSH root login is enabled (CIS violation)", [input.hostname])
}

deny contains msg if {
    input.password_authentication == "passwordauthentication yes"
    msg := sprintf("%s: SSH password authentication is enabled (CIS violation)", [input.hostname])
}

deny contains msg if {
    input.ufw_status == "Status: inactive"
    msg := sprintf("%s: Firewall (ufw) is disabled (CIS violation)", [input.hostname])
}
deny contains msg if {
    to_number(split(input.max_auth_tries, " ")[1]) > 4
    msg := sprintf("%s: SSH MaxAuthTries is too high (CIS violation)", [input.hostname])
}

deny contains msg if {
    input.x11_forwarding == "x11forwarding yes"
    msg := sprintf("%s: SSH X11Forwarding is enabled (CIS violation)", [input.hostname])
}

deny contains msg if {
    input.unattended_upgrades != "enabled"
    msg := sprintf("%s: Automatic security updates are not enabled (CIS violation)", [input.hostname])
}

deny contains msg if {
    input.permit_empty_passwords == "permitemptypasswords yes"
    msg := sprintf("%s: SSH PermitEmptyPasswords is enabled (CIS violation)", [input.hostname])
}

deny contains msg if {
    input.ignore_rhosts == "ignorerhosts no"
    msg := sprintf("%s: SSH IgnoreRhosts is disabled (CIS violation)", [input.hostname])
}

deny contains msg if {
    to_number(split(input.client_alive_interval, " ")[1]) == 0
    msg := sprintf("%s: SSH ClientAliveInterval is not set (CIS violation)", [input.hostname])
}

deny contains msg if {
    to_number(input.pass_max_days) > 90
    msg := sprintf("%s: Password max age exceeds 90 days (CIS violation)", [input.hostname])
}
deny contains msg if {
    to_number(split(input.login_grace_time, " ")[1]) > 60
    msg := sprintf("%s: SSH LoginGraceTime exceeds 60 seconds (CIS violation)", [input.hostname])
}

deny contains msg if {
    input.log_level == "loglevel QUIET"
    msg := sprintf("%s: SSH LogLevel is set to QUIET (CIS violation)", [input.hostname])
}

deny contains msg if {
    to_number(input.passwd_perms) > 644
    msg := sprintf("%s: /etc/passwd permissions are too permissive (CIS violation)", [input.hostname])
}

deny contains msg if {
    to_number(input.shadow_perms) > 640
    msg := sprintf("%s: /etc/shadow permissions are too permissive (CIS violation)", [input.hostname])
}

deny contains msg if {
    input.suid_dumpable != "0"
    msg := sprintf("%s: Core dumps are not restricted (fs.suid_dumpable != 0) (CIS violation)", [input.hostname])
}
