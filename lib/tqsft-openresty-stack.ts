import * as cdk from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Port, SecurityGroup, Vpc } from 'aws-cdk-lib/aws-ec2';
import { AwsLogDriver, Cluster, ContainerImage, Ec2Service, Ec2TaskDefinition, NetworkMode, PlacementStrategy, Protocol } from 'aws-cdk-lib/aws-ecs';
import { SslPolicy, Protocol as ProtocolELB, NetworkLoadBalancer, NetworkTargetGroup } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { DnsRecordType, PrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class TqsftOpenrestyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Parameters required
    const vpcId = StringParameter.valueFromLookup(this, 'TqsftStack-VpcId');
    const ecsClusterName = cdk.Fn.importValue('TqsftStack-ClusterName');
    const nlbArn = cdk.Fn.importValue('TqsftStack-NLBArn');
    const nlbSgId = cdk.Fn.importValue('TqsftStack-NLBSG');
    const dnsNsId = cdk.Fn.importValue('TqsftStack-NsId');
    const dnsNsArn = cdk.Fn.importValue('TqsftStack-NsArn');
    const dnsNsName = cdk.Fn.importValue('TqsftStack-NsName');
    
    const nlbSg = SecurityGroup.fromSecurityGroupId(this, 'NLB-SG', nlbSgId)
    const vpc = Vpc.fromLookup(this, "vpc", {
      vpcId: vpcId
    });

    const ecsCluster = Cluster.fromClusterAttributes(this, "tqsftCluster", {
      clusterName: ecsClusterName,
      vpc: vpc,
      securityGroups: [  ]
    })

    const tqsftLogGroup = LogGroup.fromLogGroupName(this, "TqsftLogGroup", "/ecs/tqsft-services");

    const TqsftDnsNs = PrivateDnsNamespace.fromPrivateDnsNamespaceAttributes(this, "PrivateDnsNS", {
      namespaceId: dnsNsId,
      namespaceArn: dnsNsArn,
      namespaceName: dnsNsName,
    })

    const nlb = NetworkLoadBalancer.fromNetworkLoadBalancerAttributes(this, 'Tqsft-NLB', {
      loadBalancerArn: nlbArn
    })

    const s3Bucket = Bucket.fromBucketName(this, "EcsClustersSpace", "ecs-clusters-space");

    const ecsPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      resources: [ '*' ],
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:*'
      ]
    });

    const ecsTaskDefPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      resources: [ '*' ],
      actions: [
        'ssmmessages:CreateControlChannel',
        'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel',
        'ssmmessages:OpenDataChannel'
      ]
    });

    const openRestyLogDriver = new AwsLogDriver({
      streamPrefix: 'OpenRestyLogs',
      logGroup: tqsftLogGroup
    });

    const ecsOpenRestyTaskDef = new Ec2TaskDefinition(this, `OpenrestyTaskDef`, {
      networkMode: NetworkMode.AWS_VPC
    })

    const ecsOpenRestyContainer = ecsOpenRestyTaskDef.addContainer(`OpenrestyContainer`, {
      image: ContainerImage.fromRegistry("bitnami/openresty"),
      cpu: 512,
      memoryLimitMiB: 512,
      logging: openRestyLogDriver,
      containerName: "OpenResty",
    })

    ecsOpenRestyContainer.addPortMappings({
      containerPort:8080,
      hostPort: 8080,
      name: "web"
    })

    ecsOpenRestyContainer.addPortMappings({
      containerPort:8443,
      hostPort: 8443,
      name: "web-secure"
    })

    ecsOpenRestyContainer.addToExecutionPolicy(ecsTaskDefPolicy)
    ecsOpenRestyTaskDef.addToExecutionRolePolicy(ecsPolicy)
    ecsOpenRestyTaskDef.addToTaskRolePolicy(ecsTaskDefPolicy)

    s3Bucket.grantReadWrite(ecsOpenRestyTaskDef.taskRole);

    const openRestyService = new Ec2Service(this, `OpenrestyService`, {
      serviceName: 'OpenRestyService',
      cluster: ecsCluster,
      taskDefinition: ecsOpenRestyTaskDef,
      desiredCount: 0,
      placementStrategies: [
        PlacementStrategy.packedByMemory(),
        PlacementStrategy.packedByCpu(),
      ],
      capacityProviderStrategies: [
        {
          capacityProvider: "AL2023AsgCapProvider",
          weight: 1,
        }
      ],
      enableExecuteCommand: true,
      cloudMapOptions: {
        name: 'openresty',
        cloudMapNamespace: TqsftDnsNs,
        dnsRecordType: DnsRecordType.A
      },
    });

    openRestyService.connections.allowFromAnyIpv4(Port.tcp(8080));
    openRestyService.connections.allowFromAnyIpv4(Port.tcp(8443));

    const nlbOpenRestyHttpListener = nlb.addListener('OpenRestyHttpListener', {
      port: 80
    });

    const nlbOpenRestyHttpsListener = nlb.addListener('OpenRestyHttpsListener', {
      port: 443,
      sslPolicy: SslPolicy.RECOMMENDED_TLS,
      protocol: ProtocolELB.TLS,
      certificates: [
        Certificate.fromCertificateArn(this, 'TeqsoftCert',`arn:aws:acm:${process.env.CDK_DEFAULT_REGION}:${process.env.CDK_DEFAULT_ACCOUNT}:certificate/1ee19594-575a-4a7f-b9e4-d344d33e33e8`)
      ]
    });

    const openRestyHttpTargetGroup = new NetworkTargetGroup(this, 'OpenRestyHttpTarget', {
      targetGroupName: "OpenRestyHttpTargetGroup",
      port: 80,
      targets: [
        openRestyService.loadBalancerTarget({
          containerName: "OpenResty",
          containerPort: 8080,
          protocol: Protocol.TCP
        })
      ],
      protocol: ProtocolELB.TCP,
      vpc: vpc
    })

    const openRestyHttpsTargetGroup = new NetworkTargetGroup(this, 'OpenRestyHttpsTarget', {
      targetGroupName: "OpenRestyHttpsTargetGroup",
      port: 443,
      targets: [
        openRestyService.loadBalancerTarget({
          containerName: "OpenResty",
          containerPort: 8080
        })
      ],
      protocol: ProtocolELB.TCP,
      vpc: vpc
    })

    nlbOpenRestyHttpListener.addTargetGroups('OpenRestyHttpTG', openRestyHttpTargetGroup);
    nlbOpenRestyHttpsListener.addTargetGroups('OpenRestyHttpsTG', openRestyHttpsTargetGroup);

  }
}
