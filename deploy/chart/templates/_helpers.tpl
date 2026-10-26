{{/*
Shared naming, labels and the three things every workload needs: the database environment, the
security context and the node pinning.
*/}}

{{- define "moodboard.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "moodboard.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "moodboard.labels" -}}
app.kubernetes.io/name: {{ include "moodboard.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/* Image reference for one component, e.g. (include "moodboard.image" (dict "root" . "component" "api")) */}}
{{- define "moodboard.image" -}}
{{- $root := .root -}}
{{- $name := index $root.Values.image.names .component -}}
{{- $tag := default $root.Chart.AppVersion $root.Values.image.tag -}}
{{- printf "%s/%s:%s" $root.Values.image.registry $name $tag -}}
{{- end -}}

{{/*
The database environment, taken straight from the CloudNativePG application secret.

The operator owns those key names, so they are read as they are rather than renamed into a copy
that would need reconciling on every password rotation (§4.3.1). `uri` alone would do; the parts
are passed as well so a non-CNPG Postgres can be wired up through the same template.
*/}}
{{- define "moodboard.databaseEnv" -}}
{{- $secret := .Values.postgres.existingSecret -}}
{{- range $key := list "uri" "host" "port" "dbname" "username" "password" }}
- name: {{ $key }}
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: {{ $key }}
{{- end }}
{{- end -}}

{{/* Queue coordinates: the bundled Valkey, or an external one. */}}
{{- define "moodboard.queueEnv" -}}
{{- $host := "" -}}
{{- if .Values.valkey.deploy -}}
{{- $host = printf "%s-valkey" (include "moodboard.fullname" .) -}}
{{- else -}}
{{- $host = required "valkey.host is required when valkey.deploy is false" .Values.valkey.host -}}
{{- end -}}
- name: VALKEY_HOST
  value: {{ $host | quote }}
- name: VALKEY_PORT
  value: {{ .Values.valkey.port | quote }}
{{- end -}}

{{- define "moodboard.securityContext" -}}
runAsNonRoot: true
runAsUser: {{ .Values.storage.runAsUser }}
runAsGroup: {{ .Values.storage.runAsGroup }}
{{- end -}}

{{/*
Pins a pod to the node that holds the HostPath. On a single node this does nothing; stated
explicitly, a later second node makes the pod visibly fail to schedule instead of the api
silently serving files the worker wrote on another node (§4.2).
*/}}
{{- define "moodboard.nodeAffinity" -}}
{{- if .Values.storage.nodeName }}
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - {{ .Values.storage.nodeName }}
{{- end }}
{{- end -}}

{{- define "moodboard.imagePullSecrets" -}}
{{- if .Values.image.pullSecret }}
imagePullSecrets:
  - name: {{ .Values.image.pullSecret }}
{{- end }}
{{- end -}}
