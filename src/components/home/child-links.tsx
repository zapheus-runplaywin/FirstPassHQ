/**
 * A parent's child in Family (one card, with what needs the parent on it) and
 * the child's own page (everything the parent opens for that child). What
 * each says is worked out in src/lib/children.ts.
 */
import { router } from 'expo-router';

import { CardGrid } from '@/components/columns';
import { FeatureCard, StatusLine } from '@/components/home/feature-card';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { childLinks, childStatus, type ChildFacts, type MyChild } from '@/lib/children';
import { useClub } from '@/lib/club';
import { useCanSeeInjuries } from '@/lib/injuries';

/** One child in Family: their name, where things stand, and it opens their page. */
export function ChildCard({ child, facts }: { child: MyChild; facts: ChildFacts }) {
  const [consent, ...rest] = childStatus(child, facts);
  return (
    <FeatureCard
      icon="user"
      title={child.name}
      detail={consent.text}
      detailTone={consent.attention ? 'attention' : 'quiet'}
      badge={facts.newActivity}
      onPress={() =>
        router.push({ pathname: '/child/[id]', params: { id: child.id, name: child.name } })
      }>
      {rest.map((line) => (
        <StatusLine key={line.key} text={line.text} tone={line.attention ? 'attention' : 'quiet'} />
      ))}
    </FeatureCard>
  );
}

/** Everything a parent opens for one child, in the same order every time. */
export function ChildLinks({ child, facts }: { child: MyChild; facts: ChildFacts }) {
  const { profile } = useAuth();
  const { features } = useClub();
  const canSeeInjuries = useCanSeeInjuries();
  const links = childLinks(child, {
    features,
    injuries: features.injuries && canSeeInjuries,
    verified: !!profile?.verified_at,
    facts,
  });
  return (
    <CardGrid gap={Spacing.two}>
      {links.map((link) => (
        <FeatureCard
          key={link.key}
          icon={link.icon}
          title={link.title}
          detail={link.detail}
          detailTone={link.attention ? 'attention' : 'quiet'}
          badge={link.badge}
          onPress={() => router.push(link.href)}
        />
      ))}
    </CardGrid>
  );
}
