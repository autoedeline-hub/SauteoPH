import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: "Terms & Privacy — Sautéo" },
      { name: "description", content: "Terms of Service, Refund Policy, and Privacy Policy for Sautéo." },
    ],
  }),
});

type Section = { id: string; label: string };

const SECTIONS: Section[] = [
  { id: "terms", label: "Terms of Service" },
  { id: "refund", label: "Refund Policy" },
  { id: "privacy", label: "Privacy Policy" },
];

function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-10 md:py-16">
        <h1 className="font-display text-3xl md:text-4xl mb-2">Terms &amp; Privacy</h1>
        <p className="text-muted-foreground text-sm mb-8">Last updated June 23, 2026</p>

        {/* In-page nav */}
        <nav className="flex flex-wrap gap-2 mb-10">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="text-xs font-medium px-3 py-1.5 rounded-full border border-border hover:bg-muted transition"
            >
              {s.label}
            </a>
          ))}
        </nav>

        {/* ── Terms of Service ── */}
        <section id="terms" className="mb-12 scroll-mt-20">
          <h2 className="font-display text-2xl mb-4">Terms of Service</h2>

          <Prose>
            <p>
              This website is operated by Sautéo. Throughout the site, the terms "we", "us" and
              "our" refer to Sautéo. We offer this website, including all information, tools and
              services available from this site to you, the user, conditioned upon your acceptance
              of all terms, conditions, policies and notices stated here.
            </p>
            <p>
              By visiting our site and/or purchasing something from us, you engage in our "Service"
              and agree to be bound by the following terms and conditions ("Terms of Service",
              "Terms"). These Terms apply to all users of the site, including without limitation
              users who are browsers, vendors, customers, merchants, and/or contributors of content.
              Please read these Terms carefully before accessing or using our website. By accessing
              or using any part of the site, you agree to be bound by these Terms. If you do not
              agree to all the terms and conditions of this agreement, then you may not access the
              website or use any services.
            </p>

            <h3>Section 1 — Online Store Terms</h3>
            <p>
              By agreeing to these Terms you represent that you are at least the age of majority in
              your province or state of residence. You may not use our products for any illegal or
              unauthorized purpose nor may you, in the use of the Service, violate any laws in your
              jurisdiction (including but not limited to copyright laws). A breach or violation of
              any of the Terms will result in an immediate termination of your Services.
            </p>

            <h3>Section 2 — General Conditions</h3>
            <p>
              We reserve the right to refuse service to anyone for any reason at any time. Credit
              card information is always encrypted during transfer over networks. You agree not to
              reproduce, duplicate, copy, sell, resell or exploit any portion of the Service without
              express written permission by us.
            </p>

            <h3>Section 3 — Accuracy of Information</h3>
            <p>
              We are not responsible if information made available on this site is not accurate,
              complete or current. The material on this site is provided for general information
              only. We reserve the right to modify the contents of this site at any time, but we
              have no obligation to update any information on our site.
            </p>

            <h3>Section 4 — Modifications to the Service and Prices</h3>
            <p>
              Prices for our products are subject to change without notice. We reserve the right at
              any time to modify or discontinue the Service (or any part or content thereof) without
              notice. We shall not be liable to you or to any third party for any modification,
              price change, suspension or discontinuance of the Service.
            </p>

            <h3>Section 5 — Products or Services</h3>
            <p>
              Certain products or services may be available exclusively online through the website
              and may have limited quantities. We reserve the right to limit the sales of our
              products or services to any person, geographic region or jurisdiction. All descriptions
              of products or product pricing are subject to change at any time without notice, at
              our sole discretion.
            </p>

            <h3>Section 6 — Accuracy of Billing and Account Information</h3>
            <p>
              We reserve the right to refuse any order you place with us. You agree to provide
              current, complete and accurate purchase information for all purchases made through our
              site.
            </p>

            <h3>Section 7 — Third-Party Links</h3>
            <p>
              Certain content, products and services available via our Service may include materials
              from third parties. We are not liable for any harm or damages related to the purchase
              or use of goods, services, resources, content, or any other transactions made in
              connection with any third-party websites.
            </p>

            <h3>Section 8 — User Comments and Submissions</h3>
            <p>
              If you send us creative ideas, suggestions, proposals, plans, or other materials, you
              agree that we may, at any time, without restriction, edit, copy, publish, distribute,
              translate and otherwise use in any medium any materials that you forward to us. You
              are solely responsible for any comments you make and their accuracy.
            </p>

            <h3>Section 9 — Errors, Inaccuracies and Omissions</h3>
            <p>
              Occasionally there may be information on our site that contains typographical errors,
              inaccuracies or omissions. We reserve the right to correct any errors, inaccuracies
              or omissions, and to change or update information or cancel orders if any information
              in the Service is inaccurate at any time without prior notice.
            </p>

            <h3>Section 10 — Prohibited Uses</h3>
            <p>
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
            </p>

            <h3>Section 11 — Disclaimer of Warranties; Limitation of Liability</h3>
            <p>
              We do not guarantee, represent or warrant that your use of our service will be
              uninterrupted, timely, secure or error-free. The service and all products and services
              delivered to you through the service are (except as expressly stated by us) provided
              "as is" and "as available" for your use, without any representation, warranties or
              conditions of any kind.
            </p>
            <p>
              In no case shall Sautéo, our directors, officers, employees, affiliates, agents,
              contractors, suppliers, service providers or licensors be liable for any injury, loss,
              claim, or any direct, indirect, incidental, punitive, special, or consequential
              damages of any kind arising from your use of any of the service or any products
              procured using the service.
            </p>

            <h3>Section 12 — Indemnification</h3>
            <p>
              You agree to indemnify, defend and hold harmless Sautéo and our affiliates, partners,
              officers, directors, agents, contractors, licensors, service providers,
              subcontractors, suppliers, and employees, harmless from any claim or demand made by
              any third party due to or arising out of your breach of these Terms of Service or your
              violation of any law or the rights of a third party.
            </p>

            <h3>Section 13 — Severability</h3>
            <p>
              In the event that any provision of these Terms of Service is determined to be
              unlawful, void or unenforceable, such provision shall nonetheless be enforceable to
              the fullest extent permitted by applicable law, and the unenforceable portion shall be
              deemed to be severed from these Terms, without affecting the validity and
              enforceability of any other remaining provisions.
            </p>

            <h3>Section 14 — Termination</h3>
            <p>
              These Terms of Service are effective unless and until terminated by either you or us.
              You may terminate these Terms of Service at any time by notifying us that you no
              longer wish to use our Services. If in our sole judgment you fail to comply with any
              term or provision of these Terms, we may terminate this agreement at any time without
              notice.
            </p>

            <h3>Section 15 — Entire Agreement</h3>
            <p>
              These Terms of Service and any policies or operating rules posted by us on this site
              constitute the entire agreement and understanding between you and us and govern your
              use of the Service, superseding any prior or contemporaneous agreements,
              communications and proposals, whether oral or written.
            </p>

            <h3>Section 16 — Governing Law</h3>
            <p>
              These Terms of Service and any separate agreements whereby we provide you services
              shall be governed by and construed in accordance with the laws of the Republic of the
              Philippines.
            </p>
          </Prose>
        </section>

        {/* ── Refund Policy ── */}
        <section id="refund" className="mb-12 scroll-mt-20">
          <h2 className="font-display text-2xl mb-4">Refund Policy</h2>
          <Prose>
            <h3>No Refunds</h3>
            <p>
              Sautéo operates on a strict no-refund policy. Once a reservation or order has been
              confirmed and payment received, it is considered final. No cash refunds will be issued
              for cancellations, no-shows, or changes of mind, regardless of the reason.
            </p>

            <h3>Dine-In Reservations</h3>
            <p>
              Confirmed dine-in reservations are non-refundable. If you are unable to attend,
              please message us via our official Messenger channel before your scheduled slot. We
              will note your absence, but no refund will be processed.
            </p>

            <h3>Pick-Up Orders</h3>
            <p>
              Once a pick-up order is placed and payment is confirmed, it is final. No
              cancellations, modifications, refunds, or transfers will be permitted after order
              confirmation. Orders not collected within your selected pickup window may be
              considered abandoned and forfeited without refund.
            </p>

            <h3>Damages and Issues</h3>
            <p>
              Please inspect your order upon receipt and contact us immediately if the item is
              defective, damaged, or if you receive the wrong item, so that we may evaluate the
              issue and make it right. Certain types of items cannot be returned, including
              perishable goods.
            </p>

            <h3>Contact</h3>
            <p>
              If you have any concerns or questions, please reach out to us via Messenger at{" "}
              <a
                href="https://www.facebook.com/messages/t/1119234891273865"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                facebook.com/sauteoph
              </a>{" "}
              before making a purchase to clarify any policies.
            </p>
          </Prose>
        </section>

        {/* ── Privacy Policy ── */}
        <section id="privacy" className="scroll-mt-20">
          <h2 className="font-display text-2xl mb-4">Privacy Policy</h2>
          <Prose>
            <p>
              This Privacy Policy describes how Sautéo ("we", "us", "our") collects, uses, and
              shares information about you when you use our website and reservation services.
            </p>

            <h3>Information We Collect</h3>
            <p>
              When you make a reservation or place an order with us, we collect personal information
              you provide directly, including your name, email address, mobile number, and party
              size. We may also collect information about your device and how you interact with our
              site (e.g. pages visited, browser type) for analytics purposes.
            </p>

            <h3>How We Use Your Information</h3>
            <p>We use the information we collect to:</p>
            <ul>
              <li>Process and confirm your reservation or order</li>
              <li>Send you booking confirmations, reminders, and service updates via email and Messenger</li>
              <li>Respond to your inquiries and provide customer support</li>
              <li>Improve our services and website</li>
            </ul>

            <h3>How We Share Your Information</h3>
            <p>
              We do not sell, trade, or otherwise transfer your personal information to outside
              parties. We may share your information with trusted third-party service providers who
              assist us in operating our website and conducting our business (e.g. payment
              processors, email and messaging services), provided those parties agree to keep this
              information confidential. We may also release your information when we believe release
              is appropriate to comply with the law or protect ours or others' rights, property, or
              safety.
            </p>

            <h3>Data Retention</h3>
            <p>
              We retain personal information for as long as necessary to fulfill the purposes for
              which it was collected, including to provide services to you and to comply with our
              legal obligations.
            </p>

            <h3>Your Rights</h3>
            <p>
              Under the Republic Act No. 10173 (Data Privacy Act of 2012), you have the right to
              access, correct, and request the deletion of your personal data. To exercise these
              rights, please contact us via Messenger at{" "}
              <a
                href="https://www.facebook.com/messages/t/1119234891273865"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                facebook.com/sauteoph
              </a>
              .
            </p>

            <h3>Cookies</h3>
            <p>
              Our website may use cookies to enhance your experience. Your web browser places
              cookies on your hard drive for record-keeping purposes and sometimes to track
              information about you. You may choose to set your browser to refuse cookies, or to
              alert you when cookies are being sent.
            </p>

            <h3>Third-Party Services</h3>
            <p>
              Our reservation and ordering system is powered by third-party services including
              Supabase (database), Vercel (hosting), and PayMaya (payment processing). Their
              respective privacy policies govern the handling of your data within those platforms.
            </p>

            <h3>Changes to This Policy</h3>
            <p>
              We reserve the right to update this Privacy Policy at any time. Changes will be
              posted on this page with an updated revision date.
            </p>

            <h3>Contact</h3>
            <p>
              Questions about this Privacy Policy? Message us on Messenger at{" "}
              <a
                href="https://www.facebook.com/messages/t/1119234891273865"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                facebook.com/sauteoph
              </a>
              .
            </p>
          </Prose>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none
      [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_p]:mb-4
      [&_h3]:text-foreground [&_h3]:font-semibold [&_h3]:text-base [&_h3]:mt-6 [&_h3]:mb-2
      [&_ul]:text-muted-foreground [&_ul]:leading-relaxed [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-5
      [&_li]:mb-1
      [&_a]:text-primary">
      {children}
    </div>
  );
}