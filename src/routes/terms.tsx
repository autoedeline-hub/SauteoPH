import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

const MESSENGER_URL = "https://www.facebook.com/messages/t/1119234891273865";
const LAST_UPDATED = "June 13, 2026";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: "Terms & Privacy — Sautéo" },
      {
        name: "description",
        content: "Sautéo's Terms of Service, Refund Policy, and Privacy Policy.",
      },
    ],
  }),
});

const SECTIONS = [
  { id: "terms-of-service", label: "Terms of Service" },
  { id: "refund-policy", label: "Refund Policy" },
  { id: "privacy-policy", label: "Privacy Policy" },
];

function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-8 md:py-12">
        <h1 className="font-display text-3xl md:text-5xl mb-1">Terms & Privacy</h1>
        <p className="text-sm text-muted-foreground mb-6">Last updated {LAST_UPDATED}</p>

        <nav className="flex flex-wrap gap-2 mb-8">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground transition"
            >
              {s.label}
            </a>
          ))}
        </nav>

        <div className="space-y-10 text-sm leading-relaxed text-muted-foreground">
          <LegalSection id="terms-of-service" title="Terms of Service">
            <LegalP>
              This service is operated by Sautéo. Throughout the site, the terms "we", "us" and
              "our" refer to Sautéo. We offer this website, including all information, tools and
              services available from this site to you, the user, conditioned upon your
              acceptance of all terms, conditions, policies and notices stated here.
            </LegalP>
            <LegalP>
              By visiting our site and/or purchasing something from us, you engage in our
              "Service" and agree to be bound by the following terms and conditions ("Terms").
              These Terms apply to all users of the site, including without limitation users who
              are browsers, vendors, customers, merchants, and/or contributors of content. Please
              read these Terms carefully before accessing or using our website. By accessing or
              using any part of the site, you agree to be bound by these Terms. If you do not
              agree to all the terms and conditions of this agreement, then you may not access the
              website or use any services.
            </LegalP>

            <Subsection title="Section 1 — Online Store Terms">
              By agreeing to these Terms you represent that you are at least the age of majority
              in your province or state of residence. You may not use our products for any
              illegal or unauthorized purpose nor may you, in the use of the Service, violate any
              laws in your jurisdiction (including but not limited to copyright laws). A breach or
              violation of any of the Terms will result in an immediate termination of your
              Services.
            </Subsection>

            <Subsection title="Section 2 — General Conditions">
              We reserve the right to refuse service to anyone for any reason at any time. Credit
              card information is always encrypted during transfer over networks. You agree not to
              reproduce, duplicate, copy, sell, resell or exploit any portion of the Service
              without express written permission by us.
            </Subsection>

            <Subsection title="Section 3 — Accuracy of Information">
              We are not responsible if information made available on this site is not accurate,
              complete or current. The material on this site is provided for general information
              only. We reserve the right to modify the contents of this site at any time, but we
              have no obligation to update any information on our site.
            </Subsection>

            <Subsection title="Section 4 — Modifications to the Service and Prices">
              Prices for our products are subject to change without notice. We reserve the right
              at any time to modify or discontinue the Service (or any part or content thereof)
              without notice at any time. We shall not be liable to you or to any third party for
              any modification, price change, suspension or discontinuance of the Service.
            </Subsection>

            <Subsection title="Section 5 — Products or Services">
              Certain products or services may be available exclusively online through the
              website and may have limited quantities. We reserve the right to limit the sales of
              our products or services to any person, geographic region or jurisdiction. All
              descriptions of products or product pricing are subject to change at any time
              without notice, at our sole discretion.
            </Subsection>

            <Subsection title="Section 6 — Accuracy of Billing and Account Information">
              We reserve the right to refuse any order you place with us. You agree to provide
              current, complete and accurate purchase information for all purchases made through
              our site.
            </Subsection>

            <Subsection title="Section 7 — Third-Party Links">
              Certain content, products and services available via our Service may include
              materials from third parties. We are not liable for any harm or damages related to
              the purchase or use of goods, services, content, or any other transactions made in
              connection with any third-party websites.
            </Subsection>

            <Subsection title="Section 8 — User Comments and Submissions">
              If you send us creative ideas, suggestions, proposals, plans, or other materials,
              you agree that we may, at any time, without restriction, edit, copy, publish,
              distribute, translate and otherwise use in any medium any materials that you forward
              to us. You are solely responsible for any comments you make and their accuracy.
            </Subsection>

            <Subsection title="Section 9 — Errors, Inaccuracies and Omissions">
              Occasionally there may be information on our site that contains typographical
              errors, inaccuracies or omissions. We reserve the right to correct any errors,
              inaccuracies or omissions, and to change or update information at any time without
              prior notice if any information in the Service is inaccurate.
            </Subsection>

            <Subsection title="Section 10 — Prohibited Uses">
              You are prohibited from using the site or its content: (a) for any unlawful purpose;
              (b) to solicit others to perform or participate in any unlawful acts; (c) to violate
              any international, federal, provincial or state regulations, rules, laws, or local
              ordinances; (d) to infringe upon or violate our intellectual property rights or the
              intellectual property rights of others; (e) to harass, abuse, insult, harm, defame,
              slander, disparage, intimidate, or discriminate based on gender, sexual orientation,
              religion, ethnicity, race, age, national origin, or disability; (f) to submit false
              or misleading information; (g) to upload or transmit viruses or any other type of
              malicious code; (h) to collect or track the personal information of others; or (i) to
              interfere with or circumvent the security features of the Service or any related
              website.
            </Subsection>

            <Subsection title="Section 11 — Disclaimer of Warranties; Limitation of Liability">
              <LegalP>
                We do not guarantee, represent or warrant that your use of our service will be
                uninterrupted, timely, secure or error-free. The service and all products and
                services delivered to you through the service are (except as expressly stated by
                us) provided "as is" and "as available" for your use, without any representation,
                warranties or conditions of any kind.
              </LegalP>
              <LegalP>
                In no case shall Sautéo, our directors, officers, employees, affiliates, agents,
                contractors, suppliers, service providers or licensors be liable for any injury,
                loss, claim, or any direct, indirect, incidental, punitive, special, or
                consequential damages of any kind arising from your use of any of the service or
                any products procured using the service.
              </LegalP>
            </Subsection>

            <Subsection title="Section 12 — Indemnification">
              You agree to indemnify, defend and hold harmless Sautéo and our affiliates,
              partners, officers, directors, agents, contractors, licensors, service providers,
              subcontractors, suppliers, and employees, harmless from any claim or demand made by
              any third party due to or arising out of your breach of these Terms of Service or
              your violation of any law or the rights of a third party.
            </Subsection>

            <Subsection title="Section 13 — Severability">
              In the event that any provision of these Terms of Service is determined to be
              unlawful, void or unenforceable, such provision shall nonetheless be enforceable to
              the fullest extent permitted by applicable law, and the unenforceable portion shall
              be deemed to be severed from these Terms, without affecting the validity and
              enforceability of any other remaining provisions.
            </Subsection>

            <Subsection title="Section 14 — Termination">
              These Terms of Service are effective unless and until terminated by either you or
              us. You may terminate these Terms of Service at any time by notifying us that you no
              longer wish to use our Services. If in our sole judgment you fail to comply with any
              term or provision of these Terms, we may terminate this agreement at any time
              without notice.
            </Subsection>

            <Subsection title="Section 15 — Entire Agreement">
              These Terms of Service and any policies or operating rules posted by us on this site
              constitute the entire agreement and understanding between you and us and govern your
              use of the Service, superseding any prior or contemporaneous agreements,
              communications and proposals, whether oral or written.
            </Subsection>

            <Subsection title="Section 16 — Governing Law">
              These Terms of Service and any separate agreements whereby we provide you services
              shall be governed by and construed in accordance with the laws of the Republic of
              the Philippines.
            </Subsection>
          </LegalSection>

          <LegalSection id="refund-policy" title="Refund Policy">
            <Subsection title="No Refunds">
              Sautéo operates on a strict no-refund policy. Once a reservation or order has been
              confirmed and payment received, it is considered final. No cash refunds will be
              issued for cancellations, no-shows, or changes of mind, regardless of the reason.
            </Subsection>

            <Subsection title="Dine-In Reservations">
              Confirmed dine-in reservations are non-refundable. If you are unable to attend,
              please message us via our official Messenger channel before your scheduled slot. We
              will note your absence, but no refund will be processed.
            </Subsection>

            <Subsection title="Pick-Up Orders">
              Once a pick-up order is placed and payment is confirmed, it is final. No
              cancellations, modifications, refunds, or transfers will be permitted after order
              confirmation. Orders not collected within your selected pickup window may be
              considered abandoned and forfeited without refund.
            </Subsection>

            <Subsection title="Damages and Issues">
              Please inspect your order upon receipt and contact us immediately if the item is
              defective, damaged, or if you receive the wrong item, so that we may evaluate the
              issue and make it right. Certain types of items cannot be returned, including
              perishable goods.
            </Subsection>

            <Subsection title="Contact">
              If you have any concerns or questions, please reach out to us via{" "}
              <a
                href={MESSENGER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline hover:no-underline"
              >
                Messenger
              </a>{" "}
              before making a purchase to clarify any policies.
            </Subsection>
          </LegalSection>

          <LegalSection id="privacy-policy" title="Privacy Policy">
            <LegalP>
              This Privacy Policy describes how Sautéo ("we", "us", "our") collects, uses, and
              shares information about you when you use our website and reservation services.
            </LegalP>

            <Subsection title="Information We Collect">
              When you make a reservation or place an order with us, we collect personal
              information you provide directly, including your name, email address, phone number,
              and party size. We may also collect information about your device and how you
              interact with our site (e.g. pages visited, browser type) for analytics purposes.
            </Subsection>

            <Subsection title="How We Use Your Information">
              <LegalP className="mb-2">We use the information we collect to:</LegalP>
              <ul className="list-disc pl-5 space-y-1">
                <li>Process and confirm your reservation or order</li>
                <li>Send you booking confirmations, reminders, and service updates via email and Messenger</li>
                <li>Respond to your inquiries and provide customer support</li>
                <li>Improve our services and website</li>
              </ul>
            </Subsection>

            <Subsection title="How We Share Your Information">
              We do not sell, trade, or otherwise transfer your personal information to outside
              parties. We may share your information with trusted third-party service providers
              who assist us in operating our website and conducting our business (e.g. payment
              processors, email and messaging services), provided those parties agree to keep this
              information confidential. We may also release your information when we believe
              release is appropriate to comply with the law or protect ours or others' rights,
              property, or safety.
            </Subsection>

            <Subsection title="Data Retention">
              We retain personal information for as long as necessary to fulfill the purposes for
              which it was collected, including to provide services to you and to comply with our
              legal obligations.
            </Subsection>

            <Subsection title="Your Rights">
              Under the Republic Act No. 10173 Data Privacy Act of 2012, you have the right to
              access, correct, and request the deletion of your personal data. To exercise these
              rights, please contact us via{" "}
              <a
                href={MESSENGER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline hover:no-underline"
              >
                Messenger
              </a>
              .
            </Subsection>

            <Subsection title="Cookies">
              Our website may use cookies to enhance your experience. Your web browser places
              cookies on your hard drive for record-keeping purposes and sometimes to track
              information about you. You may choose to set your browser to refuse cookies, or to
              alert you when cookies are being sent.
            </Subsection>

            <Subsection title="Third-Party Services">
              Our reservation and ordering system is powered by third-party services including
              Supabase (database), Vercel (hosting), and Maya/GCash (payment processing). Their
              respective privacy policies govern the handling of your data within those platforms.
            </Subsection>

            <Subsection title="Changes to This Policy">
              We reserve the right to update this Privacy Policy at any time. Changes will be
              posted on this page with an updated revision date.
            </Subsection>

            <Subsection title="Contact">
              Questions about this Privacy Policy? Message us on{" "}
              <a
                href={MESSENGER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline hover:no-underline"
              >
                Messenger
              </a>
              .
            </Subsection>
          </LegalSection>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-2xl text-foreground mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-1.5">{title}</h3>
      <div className="[&>p+p]:mt-3">{children}</div>
    </div>
  );
}

function LegalP({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={className}>{children}</p>;
}
