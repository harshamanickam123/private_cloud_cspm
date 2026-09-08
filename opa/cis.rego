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
